with open('app/index.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the exact ending
idx = content.find('reviewMobileText: { color: colors.brandSecondary, fontSize: 12, fontWeight: "700" }')
if idx >= 0:
    print("Found at:", idx)
    print("Context:")
    print(repr(content[idx:idx+200]))
else:
    print("Not found")

# Try finding nearestMobile
idx2 = content.find('nearestMobile:')
if idx2 >= 0:
    print("\nFound nearestMobile at:", idx2)
    print("Context:")
    print(repr(content[idx2:idx2+300]))