import subprocess, base64, json, os, shutil, sys
os.makedirs('dist/web/assets', exist_ok=True); os.makedirs('dist/local', exist_ok=True)
subprocess.run(['npx','esbuild','src/main.js','--bundle','--format=iife','--minify','--target=es2020','--loader:.json=json','--outfile=dist/app.js'],check=True)
app=open('dist/app.js').read().replace('</script','<\\/script')
tpl=open('src/index.html').read()
web=tpl.replace('<script>/*APP*/</script>','<script>'+app+'</script>').replace('<!--ASSETS-->','')
open('dist/web/index.html','w').write(web)
for f in os.listdir('public/assets'): shutil.copy('public/assets/'+f,'dist/web/assets/'+f)
if '--local' in sys.argv:
  a={f[:-5]:'data:image/webp;base64,'+base64.b64encode(open('public/assets/'+f,'rb').read()).decode() for f in os.listdir('public/assets')}
  loc=tpl.replace('<script>/*APP*/</script>','<script>'+app+'</script>').replace('<!--ASSETS-->','<script>window.__ASSETS__='+json.dumps(a)+'</script>')
  open('dist/local/厨房里的大航海.html','w').write(loc)
print('ok', os.path.getsize('dist/web/index.html'))
