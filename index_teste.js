const https = require('https');
const http = require('http');

const CONFIG = {
  XBZ_CNPJ: '11668069000104',
  XBZ_TOKEN: 'D23A5A4829',
  XBZ_API: 'https://api.minhaxbz.com.br:5001/api/clientes/ProdutosListar',
  WIX_TOKEN: process.env.WIX_TOKEN,
  WIX_SITE_ID: '4909da33-ea43-4dee-8d96-7ad33b7175af',
  WIX_API_BASE: 'https://www.wixapis.com',
  LIMITE_TESTE: 3,
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.substring(0, max) : str;
}

function sanitizeSlug(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function getProductName(product) {
  if (product.descricao && product.descricao.trim().length > 0) return truncate(product.descricao.trim(), 80);
  if (product.codigoXbz && product.codigoXbz.trim().length > 0) return truncate(product.codigoXbz.trim(), 80);
  return 'Produto sem nome';
}

function request(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const lib = isHttps ? https : http;
    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };
    const req = lib.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

// ============================================================
// IMPORTAR IMAGEM PARA O WIX MEDIA MANAGER
// ============================================================
async function importImageToWix(imageUrl, fileName) {
  const body = {
    url: imageUrl,
    mimeType: 'image/jpeg',
    mediaType: 'IMAGE',
    displayName: fileName,
  };

  const res = await request(
    `${CONFIG.WIX_API_BASE}/site-media/v1/files/import`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CONFIG.WIX_TOKEN}`,
        'wix-site-id': CONFIG.WIX_SITE_ID,
        'Content-Type': 'application/json',
      },
    },
    body
  );

  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`Erro ao importar imagem: ${res.status} - ${res.body.substring(0, 200)}`);
  }

  const data = JSON.parse(res.body);
  const fileId = data.file?.id;
  const wixUrl = data.file?.url || `wix:image://v1/${fileId}`;

  console.log(`   📷 Imagem importada: ${fileId}`);
  return { fileId, wixUrl };
}

// ============================================================
// BUSCAR PRODUTOS DA XBZ
// ============================================================
async function getXbzProducts() {
  console.log('🔄 Buscando produtos da XBZ...');
  const res = await request(CONFIG.XBZ_API, {
    method: 'GET',
    headers: { 'cnpj': CONFIG.XBZ_CNPJ, 'token': CONFIG.XBZ_TOKEN },
  });
  if (res.status !== 200) throw new Error(`XBZ retornou status ${res.status}`);
  const products = JSON.parse(res.body);
  const comFoto = products.filter(p => p.imageLink && p.imageLink.trim().length > 0);
  console.log(`✅ ${products.length} produtos | 📷 ${comFoto.length} com foto`);
  const teste = comFoto.slice(0, CONFIG.LIMITE_TESTE);
  console.log(`🧪 Testando com ${teste.length} produtos`);
  return teste;
}

// ============================================================
// CRIAR PRODUTO NO WIX
// ============================================================
async function createWixProduct(xbzProduct, wixImageUrl) {
  const slug = sanitizeSlug(`teste4-${xbzProduct.codigoAmigavel}-${xbzProduct.codigoXbz}`);
  const name = getProductName(xbzProduct);

  const body = {
    product: {
      name: name,
      plainDescription: xbzProduct.descricao || name,
      productType: 'PHYSICAL',
      slug: slug,
      visible: false,
      physicalProperties: {
        shippingWeightRange: { minValue: 0, maxValue: 1 },
      },
      media: {
        mainMedia: {
          image: {
            url: wixImageUrl,
            altText: truncate(name, 80),
          },
        },
        items: [
          {
            image: {
              url: wixImageUrl,
              altText: truncate(name, 80),
            },
          },
        ],
      },
      variantsInfo: {
        variants: [
          {
            sku: `TESTE4-${xbzProduct.codigoXbz}`,
            price: {
              actualPrice: { amount: '10.00' },
            },
            inventoryItem: {
              trackingMethod: 'QUANTITY',
              quantity: 999,
            },
          },
        ],
      },
    },
  };

  const res = await request(
    `${CONFIG.WIX_API_BASE}/stores/v3/products-with-inventory`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CONFIG.WIX_TOKEN}`,
        'wix-site-id': CONFIG.WIX_SITE_ID,
        'Content-Type': 'application/json',
      },
    },
    body
  );

  console.log(`   Wix status: ${res.status}`);
  if (res.status !== 200 && res.status !== 201) {
    console.warn(`   Erro: ${res.body.substring(0, 300)}`);
  }

  return { status: res.status, body: res.body };
}

// ============================================================
// SINCRONIZAÇÃO PRINCIPAL
// ============================================================
async function sync() {
  console.log('🧪 TESTE v4 — Import Image + Create Product');
  console.log(`📅 ${new Date().toLocaleString('pt-BR')}`);
  console.log('='.repeat(50));

  let criados = 0;
  let erros = 0;

  try {
    const xbzProducts = await getXbzProducts();

    for (const product of xbzProducts) {
      console.log(`\n📦 Produto: ${getProductName(product)}`);
      console.log(`   URL foto XBZ: ${product.imageLink}`);

      try {
        // 1. Importar imagem para o Wix Media Manager
        const { wixUrl } = await importImageToWix(
          product.imageLink.trim(),
          `${product.codigoXbz}.jpg`
        );

        // Aguardar imagem processar
        await sleep(2000);

        // 2. Criar produto com a imagem do Wix
        const result = await createWixProduct(product, wixUrl);

        if (result.status === 200 || result.status === 201) {
          criados++;
          console.log(`   ✅ Produto criado com sucesso!`);
        } else {
          erros++;
        }
      } catch (err) {
        erros++;
        console.warn(`   ⚠️ Erro: ${err.message}`);
      }

      await sleep(1000);
    }
  } catch (err) {
    console.error(`❌ Erro crítico: ${err.message}`);
  }

  console.log('\n' + '='.repeat(50));
  console.log('📊 RESULTADO:');
  console.log(`   ✅ Criados: ${criados}`);
  console.log(`   ❌ Erros: ${erros}`);
  console.log('\n👉 Verifique no Wix se os produtos têm FOTOS!');
  console.log('='.repeat(50));
}

sync();
