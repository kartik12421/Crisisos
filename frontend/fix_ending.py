with open('app/index.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# The file ends with just } but needs });
content = content.rstrip() + '});\n'

with open('app/index.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Fixed!")