const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const PORT = process.env.PORT || 3000;

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

  const accPath = `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
  const accRes = await riotGet(`${routing}.api.riotgames.com`, accPath, apiKey);

  if (accRes.status !== 200) {
    const msgs = { 401:'API Key inválida ou expirada', 403:'API Key sem permissão', 404:'Conta não encontrada' };
    throw { code: accRes.status, message: msgs[accRes.status] || `Erro ${accRes.status}` };
  }
  const puuid = accRes.body.puuid;

  let rankRes = await riotGet(`${platform}.api.riotgames.com`, `/lol/league/v4/entries/by-puuid/${puuid}`, apiKey);

  if (rankRes.status === 403 || rankRes.status === 404) {
    const sumRes = await riotGet(`${platform}.api.riotgames.com`, `/lol/summoner/v4/summoners/by-puuid/${puuid}`, apiKey);
    if (sumRes.status !== 200) throw { code: sumRes.status, message: `Erro ao buscar invocador: ${sumRes.status}` };
    rankRes = await riotGet(`${platform}.api.riotgames.com`, `/lol/league/v4/entries/by-summoner/${sumRes.body.id}`, apiKey);
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

    try {
      const data = await getRankData(nick.substring(0, hashIdx), nick.substring(hashIdx + 1), platform, apikey);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch(e) {
      res.writeHead(e.code || 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message || 'Erro interno' }));
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅  KatarinaJob rodando na porta ${PORT}`);
});
