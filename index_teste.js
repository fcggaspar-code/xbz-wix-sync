const https = require('https');
const http = require('http');

const CONFIG = {
  XBZ_CNPJ: '11668069000104',
  XBZ_TOKEN: 'D23A5A4829',
  XBZ_API: 'https://api.minhaxbz.com.br:5001/api/clientes/ProdutosListar',
  WIX_TOKEN: process.env.WIX_TOKEN,
  WIX_SITE_ID: '4909da33-ea43-4dee-8d96-7ad33b7175af',
  WIX_API_BASE: 'https://www.wixapis.com',
  WIX_COLLECTION: 'ProdutosXBZ',
  LIMITE_TESTE: 5,
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.substring(0, max) : str;
}

function getProductName(product) {
  if (product.descricao && product.descricao.trim().length > 0) return truncate(product.descricao.trim(), 200);
  if (product.codigoXbz && product.codigoXbz.trim().length > 0) return product.codigoXbz.trim();
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
  return comFoto.slice(0, CONFIG.LIMITE_TESTE);
}

async function createCmsItem(xbzProduct) {
  const name = getProductName(xbzProduct);

  const body = {
    dataCollectionId: CONFIG.WIX_COLLECTION,
    dataItem: {
      data: {
        name: name,
        description: xbzProduct.descricao || '',
        sku: xbzProduct.codigoXbz,
        uRLImagem: xbzProduct.imageLink.trim(),
        price: 10.00,
      },
    },
  };

  console.log(`\n📦 Criando: ${name}`);
  console.log(`   SKU: ${xbzProduct.codigoXbz}`);
  console.log(`   Foto: ${xbzProduct.imageLink}`);

  const res = await request(
    `${CONFIG.WIX_API_BASE}/wix-data/v2/items`,
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

  console.log(`   Wix Data status: ${res.status}`);
  if (res.status !== 200 && res.status !== 201) {
    console.warn(`   Erro: ${res.body.substring(0, 300)}`);
  } else {
    console.log(`   ✅ Item criado na coleção!`);
  }

  return { status: res.status, body: res.body };
}

async function sync() {
  console.log('🧪 TESTE CMS — Wix Data API com Catalog Collection');
  console.log(`📅 ${new Date().toLocaleString('pt-BR')}`);
  console.log('='.repeat(50));

  let criados = 0;
  let erros = 0;

  try {
    const xbzProducts = await getXbzProducts();

    for (const product of xbzProducts) {
      try {
        const result = await createCmsItem(product);
        if (result.status === 200 || result.status === 201) {
          criados++;
        } else {
          erros++;
        }
      } catch (err) {
        erros++;
        console.warn(`   ⚠️ Erro: ${err.message}`);
      }
      await sleep(300);
    }
  } catch (err) {
    console.error(`❌ Erro crítico: ${err.message}`);
  }

  console.log('\n' + '='.repeat(50));
  console.log('📊 RESULTADO:');
  console.log(`   ✅ Criados: ${criados}`);
  console.log(`   ❌ Erros: ${erros}`);
  console.log('\n👉 Verifique no Wix CMS se os 5 itens aparecem com URL de imagem!');
  console.log('='.repeat(50));
}

sync();
