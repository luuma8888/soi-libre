(async()=>{
 const results=[],P=ChroneaProject,S=ChroneaStorage;
 const test=async(name,fn)=>{try{await fn();results.push({name,ok:true})}catch(error){results.push({name,ok:false,error:String(error)})}};
 const assert=(x,m='Assertion')=>{if(!x)throw Error(m)};
 const p=P.create('Écriture locale'),assets=new Map(),e=P.event('Repère',{kind:'point',start:{value:{year:2012},precision:'year',qualifier:'exact'},end:null});p.timelines[0].events.push(e);
 await test('Phase 3 : JSON V3 portable sans perte',async()=>{const value=await S.portable(p,assets),r=await S.readJSON(value);assert(JSON.stringify(r.project)===JSON.stringify(p))});
 await test('Phase 3 : paquet ZIP et UTF-8 sans perte',async()=>{const r=await S.unpack(await S.pack(p,assets));assert(JSON.stringify(r.project)===JSON.stringify(p))});
 await test('Phase 3 : ZIP refuse traversée de chemin',async()=>{let refused=false;try{await S.unzip(await S.zip(new Map([['../bad',new Uint8Array([1])]])).arrayBuffer())}catch{refused=true}assert(refused)});
 await test('Phase 3 : CRC refuse corruption',async()=>{const bytes=new Uint8Array(await S.pack(p,assets).then(b=>b.arrayBuffer()));bytes[50]^=1;let refused=false;try{await S.unpack(new Blob([bytes]))}catch{refused=true}assert(refused)});
 await test('Phase 3 : média Blob et somme de contrôle',async()=>{const blob=new Blob(['notes locales'],{type:'text/plain'}),mid=P.id();p.media.push({id:mid,name:'notes.txt',mimeType:blob.type,size:blob.size,storageRef:'media/'+mid,checksum:await S.checksum(blob)});assets.set('media/'+mid,blob);e.mediaIds=[mid];const r=await S.unpack(await S.pack(p,assets));assert(await r.assets.get('media/'+mid).text()==='notes locales')});
 await test('Phase 3 : média absent bloque sauvegarde',async()=>{let refused=false;try{await S.portable(p,new Map())}catch{refused=true}assert(refused)});
 const store=new S.Store();
 await test('Phase 3 : cache IndexedDB et relecture Blobs',async()=>{assert(await store.open());await store.save(p,assets);const r=await store.load(p.id);assert(r.project.id===p.id&&r.assets.size===1)});
 await test('Phase 3 : instantané restaurable',async()=>{const next=P.clone(p);next.title='Nouveau';await store.save(next,assets);const rows=await store.snapshots(p.id);assert(rows.length);assert((await store.restoreSnapshot(rows[0])).project.title===p.title)});
 await test('Phase 3 : séparation des instantanés entre projets',async()=>{const next=P.create('Autre');await store.save(next,new Map());assert((await store.snapshots(next.id)).length===0)});
 await test('Phase 3 : repli localStorage portable',async()=>{const fallback=new S.Store();await fallback.save(p,assets);assert((await S.readJSON(JSON.parse(localStorage.getItem('chronea.project.v3')))).assets.size===1);localStorage.removeItem('chronea.project.v3')});
 return results;
})()
