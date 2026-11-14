"""Opt-in real Astra regression: English editing and durable accepted decisions.
Uses a synthetic, isolated project and local mock browser responses; no Overleaf writes.
"""
import base64, json, os, pathlib, re, select, shutil, struct, subprocess, tempfile, time
root = pathlib.Path(__file__).resolve().parents[1]
work = pathlib.Path(tempfile.mkdtemp(prefix='overleaf-prompt-smoke-'))
project = 'fedcba987654321001234568'
env = os.environ.copy()
env.update(OVERLEAF_BOT_STATE_DIR=str(work / 'state'), AGEAF_CODEX_CLI_PATH=os.environ.get('AGEAF_CODEX_CLI_PATH') or shutil.which('codex') or 'codex', AGEAF_PDFTOPPM=os.environ.get('AGEAF_PDFTOPPM') or shutil.which('pdftoppm') or 'pdftoppm')
stream = b'BT /F1 18 Tf 50 720 Td (Synthetic editing test.) Tj ET'
objects = [b'<< /Type /Catalog /Pages 2 0 R >>', b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>', b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>', b'<< /Length '+str(len(stream)).encode()+b' >>\nstream\n'+stream+b'\nendstream', b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
pdf=b'%PDF-1.4\n'; offsets=[0]
for i,obj in enumerate(objects,1):
 offsets.append(len(pdf)); pdf+=f'{i} 0 obj\n'.encode()+obj+b'\nendobj\n'
xref=len(pdf); pdf+=f'xref\n0 6\n0000000000 65535 f \n'.encode()+b''.join(f'{x:010d} 00000 n \n'.encode() for x in offsets[1:])+f'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
source = r'Our method show good accuracy on this dataset~\cite{ref2026}.'
file_path = 'sec/intro.tex'

def run(request, events=None, comment=False):
 proposals=[]; methods=[]; answer=''; done=None
 with (work/'native-stderr.log').open('a') as log:
  p=subprocess.Popen(['node','--import','tsx','host/native.ts'],cwd=root,env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=log,bufsize=0)
  def send(message):
   body=json.dumps(message).encode(); p.stdin.write(struct.pack('<I',len(body))+body);p.stdin.flush()
  def read(n):
   data=b''
   while len(data)<n:
    chunk=p.stdout.read(n-len(data))
    if not chunk:raise RuntimeError('Native host exited')
    data+=chunk
   return data
  trigger={'projectId':project,'prompt':request,'reviewEvents':events or []}
  if comment:trigger['threadId']='abcdef123'
  try:
   send({'type':'start','trigger':trigger}); deadline=time.time()+240
   while time.time()<deadline:
    if not select.select([p.stdout],[],[],10)[0]:continue
    message=json.loads(read(struct.unpack('<I',read(4))[0]))
    if message['type']=='browser_request':
     method=message['method'];args=message.get('args',{});methods.append(method)
     if method=='compile_pdf':result={'pdfId':'fixture','size':len(pdf),'compiledAt':'2026-11-14T12:00:00Z'}
     elif method=='pdf_chunk':result={'base64':base64.b64encode(pdf[args['offset']:args['offset']+262144]).decode()}
     elif method=='comment_context':
      start=source.index('show')
      result={'selectedText':{'text':'show','from':start,'to':start+4,'filePath':file_path,'verified':True},'anchorAvailable':True,'paragraph':{'text':source,'from':0,'to':len(source)},'editableRange':{'filePath':file_path,'from':0,'to':len(source)},'filePath':file_path,'discussion':{'messages':[]}}
     elif method=='list_files':result={'entities':[{'path':file_path,'type':'doc'}]}
     elif method=='read_file':
      assert args['filePath']==file_path,args
      result={'content':source,'name':file_path,'filePath':file_path,'ok':True}
     elif method=='propose_edit':
      assert args['filePath']==file_path and args['oldText'] and source.count(args['oldText'])==1,args
      assert not re.search(r'[\u4e00-\u9fff]',args['newText']),args
      edited=source.replace(args['oldText'],args['newText'],1)
      assert r'\cite{ref2026}' in edited and 'dataset' in edited,edited
      proposals.append(args);result={'status':'pending_user_approval','proposalId':len(proposals)}
     else:raise AssertionError('Unexpected tool: '+method)
     send({'type':'browser_response','id':message['id'],'result':result})
    elif message['type']=='delta':answer+=message['text'];print('ANSWER:',message['text'],flush=True)
    elif message['type']=='done':
     done=message;assert not message.get('error'),message;break
    elif message['type']=='status':print(message['text'],flush=True)
   assert done,'Timeout'
  finally:
   p.stdin.close();p.wait(timeout=8)
 return answer,done,methods,proposals

first,d1,m1,proposals=run('这里表达不够自然，请润色这一句，可以调整句式。保留原意和引用，不增加事实或增强结论。',comment=True)
assert proposals and 'read_file' in m1,(first,m1)
patch=proposals[-1]
source=source.replace(patch['oldText'],patch['newText'],1)
event={'id':'accepted-test','projectId':project,'proposalId':'first:1','status':'accepted','filePath':file_path,'oldText':patch['oldText'],'newText':patch['newText'],'at':'2026-11-14T12:01:00Z'}
question='仅检查审阅状态，不做编辑。根据会话中已确认的记录，只输出 JSON，字段 status 为上次建议的审阅状态，reason 为简短中文解释。不要提出新建议。'
second,d2,m2,p2=run(question,[event])
third,d3,m3,p3=run(question)
for answer in [second,third]:
 value=json.loads(re.search(r'\{[\s\S]*\}',answer).group())
 assert value['status']=='accepted',value
assert not p2 and not p3
assert d1['threadId']==d2['threadId']==d3['threadId']
print('PASS: Chinese editing request produced English TeX preserving citation; accepted state persisted across an empty review delta; same project conversation.',flush=True)
