with open('app/index.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix the template literal - use backticks instead of double quotes
content = content.replace(
    'backgroundColor: "${colors.error}18"',
    'backgroundColor: `\${colors.error}18`'
)

with open('app/index.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Fixed template literal!")