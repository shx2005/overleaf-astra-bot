import pathlib,subprocess,struct,json,select,time,os,tempfile,shutil
root=pathlib.Path(__file__).resolve().parents[1];work=pathlib.Path(tempfile.mkdtemp(prefix='overleaf-bot-smoke-'))
def make_pdf():
 objects=[b'<< /Type /Catalog /Pages 2 0 R >>',b'<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>']
 for page,text in [(3,'Page one marker: ORCHID-7429'),(5,'Page two marker: COBALT-3816')]:
  objects.append(f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents {page+1} 0 R >>'.encode())
  stream=f'BT /F1 18 Tf 50 720 Td ({text}) Tj ET'.encode();objects.append(b'<< /Length '+str(len(stream)).encode()+b' >>\nstream\n'+stream+b'\nendstream')
 objects.append(b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
 data=b'%PDF-1.4\n';offsets=[0]
 for i,obj in enumerate(objects,1):offsets.append(len(data));data+=f'{i} 0 obj\n'.encode()+obj+b'\nendobj\n'
 start=len(data);data+=f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'.encode()+b''.join(f'{x:010d} 00000 n \n'.encode() for x in offsets[1:]);data+=f'trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n'.encode();return data
pdf=make_pdf();(work/'context-fixture.pdf').write_bytes(pdf)
project='fedcba987654321001234567';stateRoot=work/'persistent-bot-smoke'
env=os.environ.copy();env.update(OVERLEAF_BOT_STATE_DIR=str(stateRoot),AGEAF_CODEX_CLI_PATH=os.environ.get('AGEAF_CODEX_CLI_PATH') or shutil.which('codex') or 'codex',AGEAF_PDFTOPPM=os.environ.get('AGEAF_PDFTOPPM') or shutil.which('pdftoppm') or 'pdftoppm')
def run(prompt):
 p=subprocess.Popen(['node','--import','tsx','host/native.ts'],cwd=root,env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=open(work/'persistent-bot-stderr.log','a'),bufsize=0)
 def send(m):
  b=json.dumps(m).encode();p.stdin.write(struct.pack('<I',len(b))+b);p.stdin.flush()
 def read(n):
  data=b''
  while len(data)<n:
   part=p.stdout.read(n-len(data))
   if not part:raise RuntimeError('Host exited')
   data+=part
  return data
 methods=[];text='';done=None;usages=[]
 try:
  send({'type':'start','trigger':{'projectId':project,'prompt':prompt}});deadline=time.time()+240
  while time.time()<deadline:
   if not select.select([p.stdout],[],[],10)[0]:continue
   n=struct.unpack('<I',read(4))[0];m=json.loads(read(n))
   if m['type']=='browser_request':
    method=m['method'];methods.append(method)
    if method=='compile_pdf':result={'pdfId':'fixture','size':len(pdf),'compiledAt':'2026-11-14T12:00:00Z'}
    elif method=='pdf_chunk':
     import base64
     offset=m['args']['offset'];result={'base64':base64.b64encode(pdf[offset:offset+262144]).decode()}
    elif method=='list_files':result={'entities':[{'path':'main.tex','type':'doc'}]}
    else:result={'content':'Synthetic test project','ok':True}
    send({'type':'browser_response','id':m['id'],'result':result})
   elif m['type']=='context_usage':usages.append(m['usage'])
   elif m['type']=='delta':text+=m['text'];print('ANSWER:',m['text'],flush=True)
   elif m['type']=='done':done=m;assert not m.get('error'),m;break
   elif m['type']=='status':print(m['text'],flush=True)
  assert done,'Timed out'
 finally:
  p.stdin.close();p.wait(timeout=8)
 assert any(isinstance(u.get('usedTokens'),int) and u['usedTokens']>0 for u in usages),usages
 assert any(u.get('windowSource')=='codex' for u in usages),usages
 print('CONTEXT:',json.dumps(usages[-1]),flush=True)
 return text,done,methods
first,d1,m1=run('PDF 初始化后，请记住本项目口令 LEMON-RIVER-582。只回复 READY。')
second,d2,m2=run('继续上次会话：之前的项目口令、PDF 第一页和第二页各自的独特标记是什么？不要重读 PDF 或文件。最后用 MCP 列出项目文件。')
assert d1['threadId']==d2['threadId'],(d1,d2)
assert 'compile_pdf' in m1 and 'compile_pdf' not in m2,(m1,m2)
assert 'list_files' in m2,m2
assert all(s in second for s in ['LEMON-RIVER-582','ORCHID-7429','COBALT-3816']),second
state=json.loads((stateRoot/'projects'/project/'session.json').read_text());assert state['pdf']['completedPages']==state['pdf']['pages']==2
print('PASS: complete two-page PDF initialization, same persistent thread, remembered previous command and both pages, fresh MCP after restart.',flush=True)
