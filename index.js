const https = require('https');
const http = require('http');

// ============================================================
// CONFIGURAÇÕES — preencha com seus dados
// ============================================================
const CONFIG = {
  // XBZ
  XBZ_CNPJ: '11668069000104',
  XBZ_TOKEN: 'D23A5A4829',
  XBZ_API: 'https://api.minhaxbz.com.br:5001/api/clientes/ProdutosListar',

  // Wix
  WIX_TOKEN: WIX_TOKEN: process.env.WIX_TOKEN,
  WIX_SITE_ID: '4909da33-ea43-4dee-8d96-7ad33b7175af',
  WIX_API_BASE: 'https://www.wixapis.com',
};

// ============================================================
// UTILITÁRIOS
// ============================================================
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.substring(0, max) : str;
}

function sanitizeSlug(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ============================================================
// REQUISIÇÃO HTTP GENÉRICA
// ============================================================
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
      res.on('end', () => {
        resolve({ status: res.statusCode, body: data });
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }

    req.end();
  });
}

// ============================================================
// BUSCAR PRODUTOS DA XBZ
// ============================================================
async function getXbzProducts() {
  console.log('🔄 Buscando produtos da XBZ...');

  const res = await request(CONFIG.XBZ_API, {
    method: 'GET',
    headers: {
      'cnpj': CONFIG.XBZ_CNPJ,
      'token': CONFIG.XBZ_TOKEN,
    },
  });

  if (res.status !== 200) {
    throw new Error(`XBZ retornou status ${res.status}: ${res.body}`);
  }

  const products = JSON.parse(res.body);
  console.log(`✅ ${products.length} produtos encontrados na XBZ`);
  return products;
}

// ============================================================
// BUSCAR PRODUTOS EXISTENTES NO WIX (por SKU)
// ============================================================
async function getWixProductSkus() {
  console.log('🔄 Buscando produtos existentes no Wix...');

  const skuMap = {};
  let cursor = null;

  do {
    const bodyObj = {
      query: {
        paging: { limit: 100, ...(cursor ? { cursor } : {}) },
        fields: ['id', 'sku'],
      },
    };

    const res = await request(
      `${CONFIG.WIX_API_BASE}/stores/v3/products/query`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${CONFIG.WIX_TOKEN}`,
          'wix-site-id': CONFIG.WIX_SITE_ID,
          'Content-Type': 'application/json',
        },
      },
      bodyObj
    );

    if (res.status !== 200) {
      console.warn(`⚠️ Erro ao buscar produtos Wix: ${res.status}`);
      break;
    }

    const data = JSON.parse(res.body);
    const products = data.products || [];

    for (const p of products) {
      if (p.sku) skuMap[p.sku] = p.id;
    }

    cursor = data.metadata?.cursors?.next || null;
    if (products.length < 100) break;

  } while (cursor);

  console.log(`✅ ${Object.keys(skuMap).length} produtos encontrados no Wix`);
  return skuMap;
}

// ============================================================
// CRIAR PRODUTO NO WIX
// ============================================================
async function createWixProduct(xbzProduct) {
  const slug = sanitizeSlug(`${xbzProduct.codigoAmigavel}-${xbzProduct.codigoXbz}`);

  const body = {
    product: {
      name: truncate(xbzProduct.descricao, 80),
      plainDescription: xbzProduct.descricao || '',
      productType: 'PHYSICAL',
      slug: slug,
      visible: false,
      physicalProperties: {
        weight: 0,
        shippingRequired: true,
      },
      variantsInfo: {
        variants: [
          {
            sku: xbzProduct.codigoXbz,
            price: {
              basePrice: { amount: '10.00', currency: 'BRL' },
              actualPrice: { amount: '10.00', currency: 'BRL' },
            },
          },
        ],
      },
    },
  };

  // Adicionar imagem se disponível
  if (xbzProduct.imageLink) {
    body.product.media = {
      items: [
        {
          image: { url: xbzProduct.imageLink },
        },
      ],
    };
  }

  const res = await request(
    `${CONFIG.WIX_API_BASE}/stores/v3/products`,
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

  return { status: res.status, body: res.body };
}

// ============================================================
// SINCRONIZAÇÃO PRINCIPAL
// ============================================================
async function sync() {
  console.log('🚀 Iniciando sincronização XBZ → Wix');
  console.log(`📅 ${new Date().toLocaleString('pt-BR')}`);
  console.log('='.repeat(50));

  let criados = 0;
  let erros = 0;
  let ignorados = 0;

  try {
    // 1. Buscar produtos da XBZ
    const xbzProducts = await getXbzProducts();

    // 2. Buscar SKUs existentes no Wix
    const wixSkus = await getWixProductSkus();

    console.log(`\n🔄 Processando ${xbzProducts.length} produtos...`);

    // 3. Processar cada produto
    for (let i = 0; i < xbzProducts.length; i++) {
      const product = xbzProducts[i];

      // Pular se já existe no Wix
      if (wixSkus[product.codigoXbz]) {
        ignorados++;
        continue;
      }

      // Criar produto novo
      try {
        const result = await createWixProduct(product);

        if (result.status === 200 || result.status === 201) {
          criados++;
          if (criados % 10 === 0) {
            console.log(`   ✅ ${criados} produtos criados...`);
          }
        } else {
          erros++;
          if (erros <= 5) {
            console.warn(`   ⚠️ Erro no produto ${product.codigoXbz}: ${result.status} - ${result.body.substring(0, 100)}`);
          }
        }
      } catch (err) {
        erros++;
        if (erros <= 5) {
          console.warn(`   ⚠️ Exceção no produto ${product.codigoXbz}: ${err.message}`);
        }
      }

      // Pausa a cada 10 produtos para evitar rate limit
      if (i % 10 === 0 && i > 0) {
        await sleep(500);
      }
    }

  } catch (err) {
    console.error(`❌ Erro crítico: ${err.message}`);
  }

  console.log('\n' + '='.repeat(50));
  console.log('📊 RESULTADO DA SINCRONIZAÇÃO:');
  console.log(`   ✅ Criados: ${criados}`);
  console.log(`   ⏭️  Ignorados (já existiam): ${ignorados}`);
  console.log(`   ❌ Erros: ${erros}`);
  console.log('='.repeat(50));
}

// ============================================================
// EXECUTAR
// ============================================================
sync();
