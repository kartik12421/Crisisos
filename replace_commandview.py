# Replace old CommandView with new one in index.tsx
with open('frontend/app/index.tsx', 'r') as f:
    content = f.read()

# Read the new CommandView
with open('new_commandview.txt', 'r') as f:
    new_command = f.read()

# Find the old CommandView boundaries
start_idx = content.find('function CommandView({ signal }: { signal: number }) {')
if start_idx == -1:
    print('CommandView not found!')
    exit(1)

# Find the next function definition after CommandView
next_func_idx = content.find('\nfunction ResponderView', start_idx)
if next_func_idx == -1:
    print('ResponderView not found after CommandView!')
    exit(1)

# Replace
old_command = content[start_idx:next_func_idx]
content = content[:start_idx] + new_command + content[next_func_idx:]

with open('frontend/app/index.tsx', 'w') as f:
    f.write(content)

print('CommandView replaced successfully!')
print(f'File length: {len(content)}')