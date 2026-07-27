// field-deploy — Cloudflare Worker v4 (OIDC auth)
// URL: field-deploy.jeffunglesbee.workers.dev
//
// AUTH: GitHub Actions OIDC tokens — zero credential management.
//   CI generates OIDC token automatically (permissions: id-token: write).
//   Courier verifies JWT signature against GitHub's public JWKS endpoint.
//   No PATs or secrets needed in CI or GitHub secrets for auth.
//
// GITHUB_PAT WORKER SECRET (set ONCE, persists across code deploys):
//   echo "<PAT>" | wrangler secret put GITHUB_PAT --name field-deploy
//   Courier uses this internally for all GitHub API calls.
//   wrangler deploy does NOT overwrite Worker secrets — set once, stays forever.
//
// CI USAGE (in deploy.yml — see full example in workflow file):
//   permissions:
//     id-token: write   # auto-generates OIDC token, no config needed
//   run: |
//     TOKEN=$(curl -sH "Authorization: Bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
//       "${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=field-deploy" | jq -r .value)
//     curl -X POST https://field-deploy.jeffunglesbee.workers.dev/secret \
//       -H "Authorization: Bearer $TOKEN" \
//       -d '{"name":"CLOUDFLARE_API_TOKEN","value":"$CF_TOKEN"}'

const DEFAULT_OWNER = 'jeffunglesbee-create';
const DEFAULT_REPO  = 'jubilant-bassoon';
const BRANCH        = 'main';
const OIDC_ISSUER   = 'https://token.actions.githubusercontent.com';
const OIDC_AUDIENCE = 'field-deploy';
const ALLOWED_REPOS = [
  'jeffunglesbee-create/field-relay-nba',
  'jeffunglesbee-create/jubilant-bassoon',  // Layer 2 AI screenshot review
];

// ── OIDC Verification ─────────────────────────────────────────────────────────
async function verifyGitHubOIDC(token) {
  if (!token) return null;
  try {
    const b64 = s => s.replace(/-/g,'+').replace(/_/g,'/');
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const header  = JSON.parse(atob(b64(parts[0])));
    const payload = JSON.parse(atob(b64(parts[1])));
    if (payload.iss !== OIDC_ISSUER) return null;
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(OIDC_AUDIENCE)) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (!ALLOWED_REPOS.includes(payload.repository)) return null;
    const jwksRes = await fetch(`${OIDC_ISSUER}/.well-known/jwks`,{signal:AbortSignal.timeout(5000)});
    if (!jwksRes.ok) return null;
    const {keys} = await jwksRes.json();
    const jwk = keys.find(k => k.kid === header.kid);
    if (!jwk) return null;
    const cryptoKey = await crypto.subtle.importKey(
      'jwk', jwk, {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'}, false, ['verify']);
    const sigInput = new TextEncoder().encode(parts[0]+'.'+parts[1]);
    const sigBytes = Uint8Array.from(atob(b64(parts[2])), c=>c.charCodeAt(0));
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5',cryptoKey,sigBytes,sigInput);
    return valid ? payload : null;
  } catch { return null; }
}

const GH_HEADERS = pat => ({
  'Authorization':`Bearer ${pat}`,'Accept':'application/vnd.github+json',
  'Content-Type':'application/json','User-Agent':'FIELD-Deploy-Courier/4.0',
  'X-GitHub-Api-Version':'2022-11-28',
});

// ── BLAKE2b ───────────────────────────────────────────────────────────────────
const B2IV=[0x6A09E667F3BCC908n,0xBB67AE8584CAA73Bn,0x3C6EF372FE94F82Bn,0xA54FF53A5F1D36F1n,0x510E527FADE682D1n,0x9B05688C2B3E6C1Fn,0x1F83D9ABFB41BD6Bn,0x5BE0CD19137E2179n];
const B2S=[[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15],[14,10,4,8,9,15,13,6,1,12,0,2,11,7,5,3],[11,8,12,0,5,2,15,13,10,14,3,6,7,1,9,4],[7,9,3,1,13,12,11,14,2,6,5,10,4,0,15,8],[9,0,5,7,2,4,10,15,14,1,11,12,6,8,3,13],[2,12,6,10,0,11,8,3,4,13,7,5,15,14,1,9],[12,5,1,15,14,13,4,10,0,7,6,3,9,2,8,11],[13,11,7,14,12,1,3,9,5,0,15,4,8,6,2,10],[6,15,14,9,11,3,0,8,12,2,13,7,1,4,10,5],[10,2,8,4,7,6,1,5,15,11,9,14,3,12,13,0]];
const M64=0xFFFFFFFFFFFFFFFFn;
function b2r(x,n){const b=BigInt(n);return((x>>b)|((x<<(64n-b))&M64))&M64;}
function b2G(v,a,b,c,d,x,y){v[a]=(v[a]+v[b]+x)&M64;v[d]=b2r(v[d]^v[a],32);v[c]=(v[c]+v[d])&M64;v[b]=b2r(v[b]^v[c],24);v[a]=(v[a]+v[b]+y)&M64;v[d]=b2r(v[d]^v[a],16);v[c]=(v[c]+v[d])&M64;v[b]=b2r(v[b]^v[c],63);}
function blake2b(inp,olen){
  const h=[...B2IV];h[0]^=0x01010000n|BigInt(olen);
  const pl=Math.ceil(Math.max(128,inp.length)/128)*128;const pd=new Uint8Array(pl);pd.set(inp);const nb=pl/128;
  for(let bi=0;bi<nb;bi++){
    const blk=pd.subarray(bi*128,bi*128+128);
    const m=Array.from({length:16},(_,j)=>{const o=j*8;return BigInt(blk[o])|(BigInt(blk[o+1])<<8n)|(BigInt(blk[o+2])<<16n)|(BigInt(blk[o+3])<<24n)|(BigInt(blk[o+4])<<32n)|(BigInt(blk[o+5])<<40n)|(BigInt(blk[o+6])<<48n)|(BigInt(blk[o+7])<<56n);});
    const v=[...h,...B2IV];v[12]=(v[12]^BigInt(Math.min((bi+1)*128,inp.length)))&M64;if(bi===nb-1)v[14]=(~v[14])&M64;
    for(let r=0;r<12;r++){const s=B2S[r%10];b2G(v,0,4,8,12,m[s[0]],m[s[1]]);b2G(v,1,5,9,13,m[s[2]],m[s[3]]);b2G(v,2,6,10,14,m[s[4]],m[s[5]]);b2G(v,3,7,11,15,m[s[6]],m[s[7]]);b2G(v,0,5,10,15,m[s[8]],m[s[9]]);b2G(v,1,6,11,12,m[s[10]],m[s[11]]);b2G(v,2,7,8,13,m[s[12]],m[s[13]]);b2G(v,3,4,9,14,m[s[14]],m[s[15]]);}
    for(let j=0;j<8;j++)h[j]=(h[j]^v[j]^v[j+8])&M64;
  }
  return new Uint8Array(olen).map((_,i)=>Number((h[i>>3]>>(BigInt((i&7)*8)))&0xFFn));
}

// ── Salsa20/HSalsa20/XSalsa20/Poly1305 ───────────────────────────────────────
const SS=new Uint8Array([101,120,112,97,110,100,32,51,50,45,98,121,116,101,32,107]);
const r32=(b,i)=>(b[i]|(b[i+1]<<8)|(b[i+2]<<16)|(b[i+3]<<24))>>>0;
const w32=(b,i,v)=>{b[i]=v;b[i+1]=v>>>8;b[i+2]=v>>>16;b[i+3]=v>>>24;};
function hsalsa20(k,n){let x0=r32(SS,0),x1=r32(k,0),x2=r32(k,4),x3=r32(k,8),x4=r32(k,12),x5=r32(SS,4),x6=r32(n,0),x7=r32(n,4),x8=r32(n,8),x9=r32(n,12),x10=r32(SS,8),x11=r32(k,16),x12=r32(k,20),x13=r32(k,24),x14=r32(k,28),x15=r32(SS,12),u;for(let i=0;i<20;i+=2){u=x0+x12|0;x4^=u<<7|u>>>25;u=x4+x0|0;x8^=u<<9|u>>>23;u=x8+x4|0;x12^=u<<13|u>>>19;u=x12+x8|0;x0^=u<<18|u>>>14;u=x5+x1|0;x9^=u<<7|u>>>25;u=x9+x5|0;x13^=u<<9|u>>>23;u=x13+x9|0;x1^=u<<13|u>>>19;u=x1+x13|0;x5^=u<<18|u>>>14;u=x10+x6|0;x14^=u<<7|u>>>25;u=x14+x10|0;x2^=u<<9|u>>>23;u=x2+x14|0;x6^=u<<13|u>>>19;u=x6+x2|0;x10^=u<<18|u>>>14;u=x15+x11|0;x3^=u<<7|u>>>25;u=x3+x15|0;x7^=u<<9|u>>>23;u=x7+x3|0;x11^=u<<13|u>>>19;u=x11+x7|0;x15^=u<<18|u>>>14;u=x0+x3|0;x1^=u<<7|u>>>25;u=x1+x0|0;x2^=u<<9|u>>>23;u=x2+x1|0;x3^=u<<13|u>>>19;u=x3+x2|0;x0^=u<<18|u>>>14;u=x5+x4|0;x6^=u<<7|u>>>25;u=x6+x5|0;x7^=u<<9|u>>>23;u=x7+x6|0;x4^=u<<13|u>>>19;u=x4+x7|0;x5^=u<<18|u>>>14;u=x10+x9|0;x11^=u<<7|u>>>25;u=x11+x10|0;x8^=u<<9|u>>>23;u=x8+x11|0;x9^=u<<13|u>>>19;u=x9+x8|0;x10^=u<<18|u>>>14;u=x15+x14|0;x12^=u<<7|u>>>25;u=x12+x15|0;x13^=u<<9|u>>>23;u=x13+x12|0;x14^=u<<13|u>>>19;u=x14+x13|0;x15^=u<<18|u>>>14;}const o=new Uint8Array(32);w32(o,0,x0);w32(o,4,x5);w32(o,8,x10);w32(o,12,x15);w32(o,16,x6);w32(o,20,x7);w32(o,24,x8);w32(o,28,x9);return o;}
function salsa20Blk(k,n8,ctr){let x0=r32(SS,0),x1=r32(k,0),x2=r32(k,4),x3=r32(k,8),x4=r32(k,12),x5=r32(SS,4),x6=r32(n8,0),x7=r32(n8,4),x8=ctr>>>0,x9=Math.floor(ctr/0x100000000)>>>0,x10=r32(SS,8),x11=r32(k,16),x12=r32(k,20),x13=r32(k,24),x14=r32(k,28),x15=r32(SS,12);const j=[x0,x1,x2,x3,x4,x5,x6,x7,x8,x9,x10,x11,x12,x13,x14,x15];let u;for(let i=0;i<20;i+=2){u=x0+x12|0;x4^=u<<7|u>>>25;u=x4+x0|0;x8^=u<<9|u>>>23;u=x8+x4|0;x12^=u<<13|u>>>19;u=x12+x8|0;x0^=u<<18|u>>>14;u=x5+x1|0;x9^=u<<7|u>>>25;u=x9+x5|0;x13^=u<<9|u>>>23;u=x13+x9|0;x1^=u<<13|u>>>19;u=x1+x13|0;x5^=u<<18|u>>>14;u=x10+x6|0;x14^=u<<7|u>>>25;u=x14+x10|0;x2^=u<<9|u>>>23;u=x2+x14|0;x6^=u<<13|u>>>19;u=x6+x2|0;x10^=u<<18|u>>>14;u=x15+x11|0;x3^=u<<7|u>>>25;u=x3+x15|0;x7^=u<<9|u>>>23;u=x7+x3|0;x11^=u<<13|u>>>19;u=x11+x7|0;x15^=u<<18|u>>>14;u=x0+x3|0;x1^=u<<7|u>>>25;u=x1+x0|0;x2^=u<<9|u>>>23;u=x2+x1|0;x3^=u<<13|u>>>19;u=x3+x2|0;x0^=u<<18|u>>>14;u=x5+x4|0;x6^=u<<7|u>>>25;u=x6+x5|0;x7^=u<<9|u>>>23;u=x7+x6|0;x4^=u<<13|u>>>19;u=x4+x7|0;x5^=u<<18|u>>>14;u=x10+x9|0;x11^=u<<7|u>>>25;u=x11+x10|0;x8^=u<<9|u>>>23;u=x8+x11|0;x9^=u<<13|u>>>19;u=x9+x8|0;x10^=u<<18|u>>>14;u=x15+x14|0;x12^=u<<7|u>>>25;u=x12+x15|0;x13^=u<<9|u>>>23;u=x13+x12|0;x14^=u<<13|u>>>19;u=x14+x13|0;x15^=u<<18|u>>>14;}const s=[x0,x1,x2,x3,x4,x5,x6,x7,x8,x9,x10,x11,x12,x13,x14,x15];const o=new Uint8Array(64);for(let i=0;i<16;i++)w32(o,i*4,(s[i]+j[i])|0);return o;}
function xsalsa20XOR(msg,nonce,key){const sub=hsalsa20(key,nonce.subarray(0,16)),n8=nonce.subarray(16,24);const out=new Uint8Array(msg.length);for(let i=0;i<msg.length;i+=64){const b=salsa20Blk(sub,n8,Math.floor(i/64));for(let j=0;j<64&&i+j<msg.length;j++)out[i+j]=msg[i+j]^b[j];}return out;}
function rleN(b){let n=0n;for(let i=0;i<b.length;i++)n|=BigInt(b[i])<<BigInt(i*8);return n;}
function wle16(n){const o=new Uint8Array(16);for(let i=0;i<16;i++){o[i]=Number(n&0xFFn);n>>=8n;}return o;}
function poly1305(msg,key){const rv=rleN(key.subarray(0,16))&0x0ffffffc0ffffffc0ffffffc0fffffffn;const sv=rleN(key.subarray(16,32));const p=(1n<<130n)-5n;let h=0n;for(let i=0;i<msg.length;i+=16){const bl=msg.subarray(i,Math.min(i+16,msg.length));const pd=new Uint8Array(17);pd.set(bl);pd[bl.length]=1;h=((h+rleN(pd))*rv)%p;}return wle16((h+sv)&((1n<<128n)-1n));}
function secretboxSeal(msg,nonce,key){const pd=new Uint8Array(32+msg.length);pd.set(msg,32);const st=xsalsa20XOR(pd,nonce,key);const mac=poly1305(st.subarray(32),st.subarray(0,32));const out=new Uint8Array(16+msg.length);out.set(mac);out.set(st.subarray(32),16);return out;}
function b64ToU8(s){const b=atob(s);return new Uint8Array(b.length).map((_,i)=>b.charCodeAt(i));}
function u8ToB64(u){return btoa(String.fromCharCode(...u));}
async function sealedBox(recipPKB64,plaintext){const msg=typeof plaintext==='string'?new TextEncoder().encode(plaintext):plaintext;const rpk=b64ToU8(recipPKB64);const eph=await crypto.subtle.generateKey({name:'X25519'},true,['deriveBits']);const ephPub=new Uint8Array(await crypto.subtle.exportKey('raw',eph.publicKey));const rk=await crypto.subtle.importKey('raw',rpk,{name:'X25519'},false,[]);const dh=new Uint8Array(await crypto.subtle.deriveBits({name:'X25519',public:rk},eph.privateKey,256));const sharedKey=hsalsa20(dh,new Uint8Array(16));const ni=new Uint8Array(64);ni.set(ephPub);ni.set(rpk,32);const nonce=blake2b(ni,24);const boxed=secretboxSeal(msg,nonce,sharedKey);const out=new Uint8Array(32+boxed.length);out.set(ephPub);out.set(boxed,32);return u8ToB64(out);}

// ══════════════════════════════════════════════════════════════════════════════
// WORKER
// ══════════════════════════════════════════════════════════════════════════════
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health')
      return new Response('DEPLOY COURIER OK v4 (OIDC auth)', {headers:{'Content-Type':'text/plain','Access-Control-Allow-Origin':'*'}});
    if (request.method !== 'POST') return new Response('Not found',{status:404});
    const token = (request.headers.get('Authorization')||'').replace('Bearer ','').trim();
    const oidc  = await verifyGitHubOIDC(token);
    if (!oidc) return jr({ok:false,error:'Invalid OIDC token — must come from allowed CI workflow (permissions: id-token: write)'},401);
    let body;
    try { body = await request.json(); } catch { return jr({ok:false,error:'Invalid JSON body'},400); }
    if (!env.GITHUB_PAT) return jr({ok:false,error:'GITHUB_PAT Worker secret not set — run: echo "<PAT>" | wrangler secret put GITHUB_PAT --name field-deploy'},500);
    const ghH = GH_HEADERS(env.GITHUB_PAT);

    if (url.pathname === '/push') {
      const {file,content,message,repo,owner}=body;
      if(!file||!content||!message)return jr({ok:false,error:'Missing file, content, or message'},400);
      const ro=owner||DEFAULT_OWNER,rn=repo||DEFAULT_REPO;
      const base=`https://api.github.com/repos/${ro}/${rn}/contents/${file}`;
      let sha;
      try{const g=await fetch(base,{headers:ghH});if(g.ok)sha=(await g.json()).sha;else if(g.status!==404)return jr({ok:false,error:`GET ${g.status}: ${await g.text()}`},502);}catch(e){return jr({ok:false,error:`GET failed: ${e.message}`},502);}
      try{const pb={message,content,branch:BRANCH};if(sha)pb.sha=sha;const p=await fetch(base,{method:'PUT',headers:ghH,body:JSON.stringify(pb)});const res=await p.json();if(!p.ok)return jr({ok:false,error:`PUT ${p.status}: ${res.message}`},502);return jr({ok:true,sha:res.commit?.sha,url:res.content?.html_url,message:`Pushed ${file}`});}catch(e){return jr({ok:false,error:`PUT failed: ${e.message}`},502);}
    }

    if (url.pathname === '/delete') {
      const {file,message,repo,owner}=body;
      if(!file||!message)return jr({ok:false,error:'Missing file or message'},400);
      const ro=owner||DEFAULT_OWNER,rn=repo||DEFAULT_REPO;
      const base=`https://api.github.com/repos/${ro}/${rn}/contents/${file}`;
      let sha;
      try{const g=await fetch(base,{headers:ghH});if(g.status===404)return jr({ok:true,message:`${file} already absent in ${ro}/${rn}`});if(!g.ok)return jr({ok:false,error:`GET ${g.status}: ${await g.text()}`},502);sha=(await g.json()).sha;}catch(e){return jr({ok:false,error:`GET failed: ${e.message}`},502);}
      try{const d=await fetch(base,{method:'DELETE',headers:ghH,body:JSON.stringify({message,sha,branch:BRANCH})});const res=await d.json();if(!d.ok)return jr({ok:false,error:`DELETE ${d.status}: ${res.message}`},502);return jr({ok:true,message:`Deleted ${file} from ${ro}/${rn}`,commit:res.commit?.sha});}catch(e){return jr({ok:false,error:`DELETE failed: ${e.message}`},502);}
    }

    if (url.pathname === '/secret') {
      const {name,value,repo,owner}=body;
      if(!name||!value)return jr({ok:false,error:'Missing name or value'},400);
      const ro=owner||DEFAULT_OWNER,rn=repo||DEFAULT_REPO;
      const base=`https://api.github.com/repos/${ro}/${rn}/actions`;
      let kd;
      try{const r=await fetch(`${base}/secrets/public-key`,{headers:ghH});if(!r.ok)return jr({ok:false,error:`Public key ${r.status}: ${await r.text()}`},502);kd=await r.json();}catch(e){return jr({ok:false,error:`Public key failed: ${e.message}`},502);}
      let enc;
      try{enc=await sealedBox(kd.key,value);}catch(e){return jr({ok:false,error:`Encrypt failed: ${e.message}`},500);}
      try{const r=await fetch(`${base}/secrets/${name}`,{method:'PUT',headers:ghH,body:JSON.stringify({encrypted_value:enc,key_id:kd.key_id})});if(r.status===201)return jr({ok:true,message:`Secret ${name} created in ${ro}/${rn}`});if(r.status===204)return jr({ok:true,message:`Secret ${name} updated in ${ro}/${rn}`});return jr({ok:false,error:`Set secret ${r.status}: ${await r.text()}`},502);}catch(e){return jr({ok:false,error:`Set secret failed: ${e.message}`},502);}
    }

    if (url.pathname === '/layer2') {
      // Layer 2: AI screenshot review via field-claude-proxy (no ANTHROPIC_KEY needed here).
      // Courier routes through field-claude-proxy which already holds ANTHROPIC_KEY.
      // Worker-to-Worker calls can set Origin freely — proxy's ALLOWED_ORIGINS check passes.
      // Input:  { screenshots: { "360":b64, "393":b64, "820":b64, "1200":b64 }, commitMsg }
      // Output: { ok:true, results:[{width,verdict,review}], via:"field-claude-proxy" }
      const { screenshots, commitMsg='' } = body;
      if (!screenshots || typeof screenshots !== 'object')
        return jr({ ok:false, error:'Missing screenshots object { "360":b64, "393":b64, "820":b64, "1200":b64 }' }, 400);

      const VP_META = {
        360: { label:'Galaxy A36 / iPhone SE — small phone',
               ctx:'Phone layout. OTW bar visible (sticky). No ambient panel. Full-width cards.' },
        393: { label:'Pixel 8 — standard Android phone',
               ctx:'Phone layout, slightly wider. OTW bar visible. No ambient panel.' },
        820: { label:'iPad Air portrait — AMBIENT MODE (critical)',
               ctx:'Two-pane layout. LEFT (430px): masthead + schedule cards, single column. RIGHT (380px): ambient intelligence panel. OTW bar must NOT appear in left pane. Cards ≥380px. Bars must NOT stack above masthead. Right panel should show FIRE/SOON/QUIET state + live scores.' },
        1200:{ label:'Desktop — wide layout',
               ctx:'Desktop layout. OTW bar visible. No ambient right panel. Wider cards.' },
      };

      const results = [];
      for (const width of [360, 393, 820, 1200]) {
        const imgB64 = screenshots[String(width)];
        if (!imgB64) { results.push({width, verdict:'SKIP', review:'Screenshot not provided'}); continue; }
        const meta = VP_META[width] || { label:`${width}px`, ctx:'' };
        const prompt = `FIELD PWA screenshot — ${width}px (${meta.label})\nExpected: ${meta.ctx}\nRecent commit: ${commitMsg.slice(0,120)}\n\nReview for: overlapping elements, truncated text, elements outside containers, overall "overlaid/sloppy" vs clean. For 820px: is two-pane layout correct (left schedule + right intelligence panel)?\n\nRespond in exactly three lines:\nVERDICT: PASS or FAIL\nISSUES: [specific problems, or "None"]\nNOTES: [minor observations, or "None"]`;
        try {
          // Route through field-claude-proxy. Vision detection in proxy ensures Claude path.
          const r = await fetch('https://field-claude-proxy.jeffunglesbee.workers.dev', {
            method:'POST',
            headers:{
              'Content-Type':'application/json',
              'Origin':'https://field-deploy.jeffunglesbee.workers.dev',
            },
            body: JSON.stringify({
              model:'claude-sonnet-4-20250514', max_tokens:512,
              system:'You are reviewing screenshots of FIELD, a sports intelligence PWA, for layout problems. Be specific. When the layout looks correct, say so clearly.',
              messages:[{ role:'user', content:[
                { type:'image', source:{ type:'base64', media_type:'image/png', data:imgB64 }},
                { type:'text', text:prompt },
              ]}],
            }),
            signal: AbortSignal.timeout(30000),
          });
          if (!r.ok) { results.push({width, verdict:'ERROR', review:`Proxy ${r.status}: ${(await r.text().catch(()=>'')).slice(0,200)}`}); continue; }
          const d = await r.json();
          const review = d.content?.[0]?.text?.trim() || '(empty)';
          const verdict = /VERDICT:\s*PASS/i.test(review) ? 'PASS' : /VERDICT:\s*FAIL/i.test(review) ? 'FAIL' : 'UNKNOWN';
          results.push({ width, verdict, review });
        } catch(e) { results.push({width, verdict:'ERROR', review:`Request failed: ${e.message}`}); }
      }
      return jr({ ok:true, results, model:'claude-sonnet-4-20250514', via:'field-claude-proxy', repo:oidc.repository });
    }

    return new Response('Not found',{status:404});
  }
};
function jr(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});}
