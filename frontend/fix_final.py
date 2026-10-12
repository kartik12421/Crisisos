with open('app/index.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# The file should end with })); not });
content = content.rstrip()
if content.endswith('});'):
    content = content[:-3] + '}));' + '\n'

with open('app/index.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Fixed!")