with open('app/index.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix the indentation on nearestMobile line
content = content.replace(
    '    nearestMobile: { color: colors.brandSecondary, fontSize: 10, marginTop: 2, flexDirection: "row", alignItems: "center", gap: 4 },',
    '  nearestMobile: { color: colors.brandSecondary, fontSize: 10, marginTop: 2, flexDirection: "row", alignItems: "center", gap: 4 },'
)

with open('app/index.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Fixed indentation!")