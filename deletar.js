const https = require('https');

const CONFIG = {
  WIX_TOKEN: process.env.WIX_TOKEN,
  WIX_SITE_ID: '4909da33-ea43-4dee-8d96-7ad33b7175af',
  WIX_API_BASE: 'https://www.wixapis.com',
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function request(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOptions = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };
    const req = https.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function deletarTodos() {
  console.log('🗑️ Iniciando exclusão de todos os produtos do Wix...');
  let total = 0;
  let cursor = null;

  while (true) {
    // Buscar produtos
    const bodyObj = {
      query: {
        paging: { limit: 100, ...(cursor ? { cursor } : {}) },
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
      console.error(`Erro ao buscar produtos: ${res.status}`);
      break;
    }

    const data = JSON.parse(res.body);
    const products = data.products || [];

    if (products.length === 0) {
      console.log('✅ Nenhum produto restante!');
      break;
    }

    // Deletar cada produto
    for (const product of products) {
      const del = await request(
        `${CONFIG.WIX_API_BASE}/stores/v3/products/${product.id}`,
        {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${CONFIG.WIX_TOKEN}`,
            'wix-site-id': CONFIG.WIX_SITE_ID,
          },
        }
      );

      if (del.status === 200 || del.status === 204) {
        total++;
        if (total % 50 === 0) console.log(`   🗑️ ${total} produtos deletados...`);
      }

      await sleep(100);
    }

    cursor = null; // Buscar do início novamente pois produtos foram deletados
  }

  console.log(`\n✅ Total deletado: ${total} produtos`);
}

deletarTodos();
