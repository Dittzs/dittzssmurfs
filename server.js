const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const PORT = 3000;

function getRouting(platform) {
  return ({ br1:'americas', na1:'americas', la1:'americas', la2:'americas',
            euw1:'europe',  eun1:'europe',  tr1:'europe',   ru:'europe',
            kr:'asia', jp1:'asia', oc1:'sea' })[platform] || 'americas';
}

function riotGet(hostname, urlPath, apiKey) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname, path: urlPath, method: 'GET', headers: { 'X-Riot-Token': apiKey } },
      res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, body: data }); }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function getRankData(gameName, tagLine, platform, apiKey) {
  const routing = getRouting(platform);

  console.log(`\n[RIOT] Buscando: ${gameName}#${tagLine} | Região: ${platform} | Routing: ${routing}`);
  console.log(`[RIOT] API Key recebida: ${apiKey.substring(0,15)}... (${apiKey.length} chars)`);

  // 1. PUUID via Account API
  const accPath = `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
  console.log(`[RIOT] GET https://${routing}.api.riotgames.com${accPath}`);

  const accRes = await riotGet(`${routing}.api.riotgames.com`, accPath, apiKey);
  console.log(`[RIOT] Account status: ${accRes.status}`);

  if (accRes.status !== 200) {
    const msgs = { 401:'API Key inválida ou expirada', 403:'API Key sem permissão', 404:'Conta não encontrada' };
    throw { code: accRes.status, message: msgs[accRes.status] || `Erro ${accRes.status}` };
  }
  const puuid = accRes.body.puuid;

  // 2. Ranked direto por PUUID (endpoint mais novo, funciona com Dev Key)
  const rankByPuuidPath = `/lol/league/v4/entries/by-puuid/${puuid}`;
  let rankRes = await riotGet(`${platform}.api.riotgames.com`, rankByPuuidPath, apiKey);
  console.log(`[RIOT] Ranked by-puuid status: ${rankRes.status}`);

  // Fallback para summoner ID se by-puuid não funcionar
  if (rankRes.status === 403 || rankRes.status === 404) {
    console.log(`[RIOT] Fallback: tentando via summoner ID...`);
    const sumRes = await riotGet(`${platform}.api.riotgames.com`, `/lol/summoner/v4/summoners/by-puuid/${puuid}`, apiKey);
    console.log(`[RIOT] Summoner status: ${sumRes.status}`);
    if (sumRes.status !== 200) throw { code: sumRes.status, message: `Erro ao buscar invocador: ${sumRes.status}` };
    rankRes = await riotGet(`${platform}.api.riotgames.com`, `/lol/league/v4/entries/by-summoner/${sumRes.body.id}`, apiKey);
    console.log(`[RIOT] Ranked by-summoner status: ${rankRes.status}`);
  }

  if (rankRes.status !== 200) throw { code: rankRes.status, message: `Erro ao buscar ranking: ${rankRes.status}` };

  const solo = rankRes.body.find(r => r.queueType === 'RANKED_SOLO_5x5');
  if (!solo) return { elo: 'Unranked', lp: 0 };

  const tierMap = { CHALLENGER:'Challenger', GRANDMASTER:'Grandmaster', MASTER:'Master',
    DIAMOND:'Diamond', EMERALD:'Emerald', PLATINUM:'Platina',
    GOLD:'Gold', SILVER:'Silver', BRONZE:'Bronze', IRON:'Iron' };

  const tier = tierMap[solo.tier] || solo.tier;
  const elo  = ['CHALLENGER','GRANDMASTER','MASTER'].includes(solo.tier)
    ? tier : `${tier} ${solo.rank}`;
  console.log(`[RIOT] Resultado: ${elo} ${solo.leaguePoints} LP`);
  return { elo, lp: solo.leaguePoints };
}

const server = http.createServer(async (req, res) => {

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const base   = `http://localhost:${PORT}`;
  const parsed = new URL(req.url, base);

  if (parsed.pathname === '/' || parsed.pathname === '/index.html') {
    fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  if (parsed.pathname === '/icone.png') {
  fs.readFile(path.join(__dirname, 'icone.png'), (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(data);
  });
  return;
}

  if (parsed.pathname === '/rank') {
    const nick     = parsed.searchParams.get('nick')     || '';
    const platform = parsed.searchParams.get('platform') || '';
    const apikey   = parsed.searchParams.get('apikey')   || '';

    console.log(`\n[REQ] /rank nick="${nick}" platform="${platform}" apikey="${apikey.substring(0,15)}..."`);

    if (!nick || !platform || !apikey) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Parâmetros faltando: nick, platform, apikey' }));
      return;
    }

    const hashIdx = nick.indexOf('#');
    if (hashIdx === -1) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Nick inválido. Use Nome#TAG' }));
      return;
    }

    const gameName = nick.substring(0, hashIdx);
    const tagLine  = nick.substring(hashIdx + 1);

    try {
      const data = await getRankData(gameName, tagLine, platform, apikey);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch(e) {
      console.log(`[ERR] ${e.message}`);
      res.writeHead(e.code || 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message || 'Erro interno' }));
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n✅  KatarinaJob rodando em http://localhost:${PORT}\n`);
  console.log('   Abra o link acima no seu navegador.\n');
  console.log('   Os logs das requisições aparecerão aqui.\n');

  const { exec } = require('child_process');
});

