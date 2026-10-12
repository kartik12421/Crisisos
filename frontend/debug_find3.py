with open('app/index.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the exact block - search from nearestMobile to the specific } that closes the StyleSheet
start = content.find('nearestMobile: { color: colors.brandSecondary, fontSize: 10, marginTop: 2, flexDirection: "row", alignItems: "center", gap: 4 }')
if start >= 0:
    # Find the reviewMobileText line
    mid = content.find('reviewMobileText: { color: colors.brandSecondary, fontSize: 12, fontWeight: "700" }', start)
    if mid >= 0:
        print("Content from mid (100 chars):")
        print(repr(content[mid:mid+100]))