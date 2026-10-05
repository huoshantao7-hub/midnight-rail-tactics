import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {dirname,extname,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.PORT||8789);
const mime={'.html':'text/html;charset=utf-8','.css':'text/css;charset=utf-8','.mjs':'text/javascript;charset=utf-8','.js':'text/javascript;charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};
createServer(async(req,res)=>{
  try{
    const raw=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const target=resolve(root,`.${raw==='/'?'/index.html':raw}`);
    if(target!==resolve(root,'index.html')&&!target.startsWith(root+sep)){res.writeHead(403).end();return}
    const info=await stat(target);if(!info.isFile())throw Error('not a file');
    res.writeHead(200,{'Content-Type':mime[extname(target)]||'application/octet-stream','Cache-Control':'no-store'});
    res.end(await readFile(target));
  }catch{res.writeHead(404).end('Not found')}
}).listen(port,'127.0.0.1',()=>console.log(`http://127.0.0.1:${port}/`));
