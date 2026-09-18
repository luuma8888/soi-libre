/* Cache de projets et Blobs. Le fichier exporté demeure la copie portable de référence. */
const ChroneaStorage=(()=>{
  'use strict';
  const P=ChroneaProject,C=ChroneaCore,MAX_BYTES=256*1024*1024,MAX_MEDIA=20*1024*1024;
  const validatedBlobs=new WeakMap();
  const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
  const fail=m=>{throw new Error(m)};
  const crcTable=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
  function crc32(bytes){let crc=0xffffffff;for(const b of bytes)crc=crcTable[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
  function zip(files){
    const chunks=[],central=[];let offset=0;
    const u16=(v,o,n)=>v.setUint16(o,n,true),u32=(v,o,n)=>v.setUint32(o,n,true);
    for(const [name,bytes]of files){
      const filename=encoder.encode(name),crc=crc32(bytes),header=new Uint8Array(30+filename.length),h=new DataView(header.buffer);
      u32(h,0,0x04034b50);u16(h,4,20);u16(h,6,0x800);u32(h,14,crc);u32(h,18,bytes.length);u32(h,22,bytes.length);u16(h,26,filename.length);header.set(filename,30);chunks.push(header,bytes);
      const entry=new Uint8Array(46+filename.length),v=new DataView(entry.buffer);
      u32(v,0,0x02014b50);u16(v,4,20);u16(v,6,20);u16(v,8,0x800);u32(v,16,crc);u32(v,20,bytes.length);u32(v,24,bytes.length);u16(v,28,filename.length);u32(v,42,offset);entry.set(filename,46);central.push(entry);offset+=header.length+bytes.length;
    }
    const centralSize=central.reduce((n,b)=>n+b.length,0),end=new Uint8Array(22),e=new DataView(end.buffer);
    u32(e,0,0x06054b50);u16(e,8,files.size);u16(e,10,files.size);u32(e,12,centralSize);u32(e,16,offset);
    return new Blob([...chunks,...central,end],{type:'application/zip'});
  }
  async function unzip(input){
    if(input.byteLength>MAX_BYTES)fail('Paquet supérieur à 256 Mo.');
    const bytes=new Uint8Array(input),view=new DataView(input);let end=-1;
    for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(view.getUint32(i,true)===0x06054b50&&i+22+view.getUint16(i+20,true)===bytes.length){end=i;break;}
    if(end<0)fail('Archive ZIP incomplète.');
    const count=view.getUint16(end+10,true),centralOffset=view.getUint32(end+16,true),centralSize=view.getUint32(end+12,true);
    if(count>2048||view.getUint16(end+4,true)||view.getUint16(end+6,true)||centralOffset+centralSize!==end)fail('Structure ZIP non prise en charge.');
    let cursor=centralOffset,total=0;const files=new Map();
    for(let n=0;n<count;n++){
      if(cursor+46>end||view.getUint32(cursor,true)!==0x02014b50)fail('Répertoire ZIP invalide.');
      const flags=view.getUint16(cursor+8,true),method=view.getUint16(cursor+10,true),crc=view.getUint32(cursor+16,true),compressed=view.getUint32(cursor+20,true),size=view.getUint32(cursor+24,true),length=view.getUint16(cursor+28,true),extra=view.getUint16(cursor+30,true),comment=view.getUint16(cursor+32,true),local=view.getUint32(cursor+42,true);
      if(cursor+46+length+extra+comment>end||local+30>centralOffset||flags&1||![0,8].includes(method)||size>MAX_BYTES||(total+=size)>MAX_BYTES)fail('Taille, compression ou chiffrement ZIP refusé.');
      const name=decoder.decode(bytes.subarray(cursor+46,cursor+46+length));
      if(!/^(manifest\.json|project\.json|media\/[-\p{L}\p{N}_.:@+]+)$/u.test(name)||files.has(name)||name.includes('..'))fail('Chemin ZIP refusé ou dupliqué.');
      if(view.getUint32(local,true)!==0x04034b50)fail('En-tête ZIP invalide.');
      const nameLength=view.getUint16(local+26,true),extraLength=view.getUint16(local+28,true),start=local+30+nameLength+extraLength;
      if(start+compressed>centralOffset||decoder.decode(bytes.subarray(local+30,local+30+nameLength))!==name)fail('Entrée ZIP incohérente.');
      let data=bytes.slice(start,start+compressed);
      if(method===8){
        if(typeof DecompressionStream==='undefined')fail('Compression non prise en charge dans ce navigateur.');
        const reader=new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(),chunks=[];let read=0;
        while(true){const result=await reader.read();if(result.done)break;read+=result.value.length;if(read>size){await reader.cancel();fail('Archive trop décompressée.');}chunks.push(result.value);}
        data=new Uint8Array(await new Blob(chunks).arrayBuffer());
      }
      if(data.length!==size||crc32(data)!==crc)fail('Somme de contrôle ZIP incorrecte.');
      files.set(name,data);cursor+=46+length+extra+comment;
    }
    if(cursor!==end)fail('Répertoire ZIP incohérent.');return files;
  }
  function dataURL(blob){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob)});}
  function fromDataURL(value,mime,size){C.validateMedia({dataUrl:value,type:mime,size},MAX_MEDIA);const data=atob(value.split(',')[1]);return new Blob([Uint8Array.from(data,c=>c.charCodeAt(0))],{type:mime});}
  async function checksum(blob){const bytes=new Uint8Array(await blob.arrayBuffer());if(crypto.subtle){const hash=await crypto.subtle.digest('SHA-256',bytes);return 'sha256-'+Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');}return 'crc32-'+crc32(bytes).toString(16).padStart(8,'0')+'-'+bytes.length;}
  async function validateAssets(project,assets){
    let total=0;for(const media of project.media){if(media.remoteUrl)continue;const blob=assets.get(media.storageRef);if(!(blob instanceof Blob)||blob.size!==media.size||blob.type!==media.mimeType)fail('Média local absent ou incohérent : '+media.name);total+=blob.size;if(total>MAX_BYTES)fail('Médias supérieurs à 256 Mo.');let sum=validatedBlobs.get(blob);if(!sum){C.validateMedia({type:media.mimeType,size:media.size,dataUrl:await dataURL(blob)},MAX_MEDIA);sum=await checksum(blob);validatedBlobs.set(blob,sum);}if(media.checksum&&sum!==media.checksum)fail('Somme de contrôle du média incorrecte : '+media.name);media.checksum=sum;}
  }
  async function portable(project,assets){const p=P.clone(project),result={app:'Chronéa',schemaVersion:3,kind:'project',project:p,assets:{}};P.validate(p);await validateAssets(p,assets);for(const m of p.media)if(!m.remoteUrl)result.assets[m.storageRef]=await dataURL(assets.get(m.storageRef));return result;}
  async function pack(project,assets){const p=P.clone(project);P.validate(p);await validateAssets(p,assets);const files=new Map([['manifest.json',encoder.encode(JSON.stringify({app:'Chronéa',format:'chronea-package',version:1,schemaVersion:3,project:'project.json',media:p.media.filter(m=>!m.remoteUrl).map(m=>({id:m.id,path:m.storageRef,checksum:m.checksum}))}))],['project.json',encoder.encode(JSON.stringify(p))]]);for(const m of p.media)if(!m.remoteUrl){if(!/^media\/[-\p{L}\p{N}_.:@+]+$/u.test(m.storageRef)||m.storageRef.includes('..'))fail('Référence média non portable.');files.set(m.storageRef,new Uint8Array(await assets.get(m.storageRef).arrayBuffer()));}if(files.size>2048)fail('2 046 médias locaux maximum dans un paquet. Utilise le JSON pour une collection plus grande.');const blob=zip(files);if(blob.size>MAX_BYTES)fail('Paquet supérieur à 256 Mo. Réduis les médias avant export.');return blob;}
  async function unpack(file){
    const files=await unzip(await file.arrayBuffer());if(!files.has('manifest.json')||!files.has('project.json'))fail('Manifest ou projet absent.');
    const manifest=JSON.parse(decoder.decode(files.get('manifest.json'))),project=JSON.parse(decoder.decode(files.get('project.json')));C.checkTree(manifest);
    if(manifest.app!=='Chronéa'||manifest.format!=='chronea-package'||manifest.version!==1||manifest.schemaVersion!==3||manifest.project!=='project.json')fail('Version de paquet non prise en charge.');P.validate(project);
    const assets=new Map();for(const m of project.media)if(!m.remoteUrl){const data=files.get(m.storageRef);if(!data)fail('Fichier média absent du paquet.');assets.set(m.storageRef,new Blob([data],{type:m.mimeType}));}
    if(files.size!==2+assets.size)fail('Fichiers non déclarés dans le paquet.');await validateAssets(project,assets);return {project,assets,report:{fromVersion:3,toVersion:3}};
  }
  async function readJSON(data){const result=P.read(data);if(data.schemaVersion!==3){for(const [ref,value]of result.assets){const m=result.project.media.find(m=>m.storageRef===ref);result.assets.set(ref,fromDataURL(value,m.mimeType,m.size));}}else{for(const m of result.project.media)if(!m.remoteUrl){const value=data.assets?.[m.storageRef];if(!value)fail('Média absent du projet JSON.');result.assets.set(m.storageRef,fromDataURL(value,m.mimeType,m.size));}}await validateAssets(result.project,result.assets);return result;}
  const request=req=>new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});
  const transaction=tx=>new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(tx.error||new Error('Transaction locale annulée.'))});
  class Store{
    constructor(){this.db=null;this.lastProject=null;}
    async open(){if(!globalThis.indexedDB)return false;try{const req=indexedDB.open('chronea.projects.v3',1);req.onupgradeneeded=()=>{for(const name of ['projects','media','snapshots'])req.result.createObjectStore(name,{keyPath:'key'});};this.db=await request(req);return true;}catch{return false;}}
    key(project,m){return project.id+'::'+m.storageRef+'::'+(m.checksum||'legacy');}
    async load(projectId){
      if(!this.db)return null;const records=await request(this.db.transaction('projects').objectStore('projects').getAll());const record=projectId?records.find(r=>r.key===projectId):records.sort((a,b)=>b.project.updatedAt.localeCompare(a.project.updatedAt))[0];if(!record)return null;this.lastReadRaw=JSON.stringify(record.project);this.lastReadId=record.key;P.validate(record.project);const assets=new Map();for(const m of record.project.media)if(!m.remoteUrl){const row=await request(this.db.transaction('media').objectStore('media').get(this.key(record.project,m)));if(!row)fail('Média manquant dans le cache.');assets.set(m.storageRef,row.blob);}await validateAssets(record.project,assets);this.lastProject=P.clone(record.project);return {project:record.project,assets};
    }
    async save(project,assets,options={}){
      // Le contrôleur valide chaque mutation ; les autres appelants sont validés ici.
      if(!options.validated)P.validate(project);await validateAssets(project,assets);
      if(!this.db){const envelope=await portable(project,assets),raw=JSON.stringify(envelope),old=localStorage.getItem('chronea.project.v3');if(old&&old!==raw)localStorage.setItem('chronea.snapshot.v3',old);localStorage.setItem('chronea.project.v3',raw);this.lastProject=P.clone(project);return 'localStorage';}
      const snapshotRows=await request(this.db.transaction('snapshots').objectStore('snapshots').getAll());
      const tx=this.db.transaction(['projects','media','snapshots'],'readwrite'),done=transaction(tx);
      if(this.lastProject?.id===project.id){const key=project.id+'::'+Date.now();tx.objectStore('snapshots').put({key,project:P.clone(this.lastProject),at:new Date().toISOString()});const older=snapshotRows.filter(s=>s.project.id===project.id).sort((a,b)=>b.at.localeCompare(a.at)).slice(4);older.forEach(s=>tx.objectStore('snapshots').delete(s.key));}
      tx.objectStore('projects').put({key:project.id,project:P.clone(project)});
      for(const m of project.media)if(!m.remoteUrl){const blob=assets.get(m.storageRef);if(!blob)fail('Média absent avant sauvegarde.');tx.objectStore('media').put({key:this.key(project,m),blob});}
      await done;this.lastProject=P.clone(project);return 'IndexedDB';
    }
    async projects(){if(!this.db){const raw=localStorage.getItem('chronea.project.v3');return raw?[JSON.parse(raw).project]:[];}return (await request(this.db.transaction('projects').objectStore('projects').getAll())).map(row=>row.project).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));}
    async snapshots(projectId){if(!this.db){const raw=localStorage.getItem('chronea.snapshot.v3');return raw?[{key:'fallback',raw,at:''}]:[];}return (await request(this.db.transaction('snapshots').objectStore('snapshots').getAll())).filter(s=>s.project.id===projectId).sort((a,b)=>b.at.localeCompare(a.at));}
    async restoreSnapshot(row){if(row.raw)return readJSON(JSON.parse(row.raw));const assets=new Map();P.validate(row.project);for(const m of row.project.media)if(!m.remoteUrl){const record=await request(this.db.transaction('media').objectStore('media').get(this.key(row.project,m)));if(!record)fail('Média absent de l’instantané.');assets.set(m.storageRef,record.blob);}await validateAssets(row.project,assets);return {project:row.project,assets};}
  }
  return {Store,MAX_BYTES,MAX_MEDIA,crc32,zip,unzip,dataURL,fromDataURL,checksum,validateAssets,portable,pack,unpack,readJSON};
})();
