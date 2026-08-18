from pathlib import Path
p=Path('conquest.html')
s=p.read_text(encoding='utf-8')
css='<link rel="stylesheet" href="css/v112-flight-shipyard.css">'
js='<script src="js/v112-flight-shipyard.js" defer></script>'
if css not in s:
    s=s.replace('</head>', css+'\n</head>',1)
if js not in s:
    s=s.replace('</head>', js+'\n</head>',1)
# Keep the version visible in the page when a conventional version label exists.
for old in ('1.11.0','1.11'):
    s=s.replace('Version '+old, 'Version 1.11.2')
    s=s.replace('v'+old, 'v1.11.2')
p.write_text(s,encoding='utf-8')
print('patched conquest.html')
