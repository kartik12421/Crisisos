with open('app/index.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the exact block
start = content.find('nearestMobile: { color: colors.brandSecondary, fontSize: 10, marginTop: 2, flexDirection: "row", alignItems: "center", gap: 4 }')
end = content.find('});\n', start) + 4  # include });

if start >= 0 and end > start:
    old_block = content[start:end]
    print("Found block:")
    print(repr(old_block))
    
    new_block = '''  nearestMobile: { color: colors.brandSecondary, fontSize: 10, marginTop: 2, flexDirection: "row", alignItems: "center", gap: 4 },
  queueMobile: { color: colors.brandSecondary, fontSize: 10, marginTop: 2, flexDirection: "row", alignItems: "center", gap: 4 },
  reviewMobileRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border },
  reviewMobileText: { color: colors.brandSecondary, fontSize: 12, fontWeight: "700" },

  // Alerts Management styles
  alertsManagementPanel: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, borderRadius: 17, padding: 16, gap: 12, marginBottom: 8 },
  alertsManagementList: { gap: 8 },
  alertManagementCard: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border, borderRadius: 13, padding: 12, gap: 10 },
  alertManagementLeft: { flexDirection: "row", alignItems: "flex-start", gap: 10, flex: 1 },
  alertSeverityDot: { width: 10, height: 10, borderRadius: 5, marginTop: 2, flexShrink: 0 },
  alertManagementInfo: { flex: 1, minWidth: 0 },
  alertManagementTitle: { color: colors.onSurface, fontSize: 14, fontWeight: "800" },
  alertManagementMeta: { color: colors.muted, fontSize: 10, marginTop: 2 },
  alertManagementMessage: { color: colors.onSurfaceSecondary, fontSize: 11, lineHeight: 16, marginTop: 4 },
  deactivateButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 40, paddingHorizontal: 12, borderRadius: 10, backgroundColor: "${colors.error}18", borderWidth: 1, borderColor: colors.error },
  deactivateButtonText: { color: colors.error, fontSize: 11, fontWeight: "900", letterSpacing: 0.5 },
});'''
    
    content = content[:start] + new_block + content[end:]
    with open('app/index.tsx', 'w', encoding='utf-8') as f:
        f.write(content)
    print("\nReplaced successfully!")
else:
    print("Could not find exact block")