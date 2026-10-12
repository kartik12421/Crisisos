# Replace CommandView in frontend/app/index.tsx
import re

with open('frontend/app/index.tsx', 'r') as f:
    content = f.read()

print(f'File length: {len(content)}')

# Find the CommandView function (old version)
# The old version starts at "function CommandView({ signal }: { signal: number }) {"
# and ends before "function ResponderView"

# Let's find the exact boundaries
start_idx = content.find('function CommandView({ signal }: { signal: number }) {')
if start_idx == -1:
    print('CommandView not found!')
    exit(1)

# Find the next function definition after CommandView
next_func_idx = content.find('\nfunction ResponderView', start_idx)
if next_func_idx == -1:
    print('ResponderView not found after CommandView!')
    exit(1)

old_command = content[start_idx:next_func_idx]
print(f'Found CommandView at {start_idx} to {next_func_idx}, length: {len(old_command)}')
print('First 200 chars:', repr(old_command[:200]))
print('Last 200 chars:', repr(old_command[-200:]))

# Save the old version for reference
with open('old_commandview.txt', 'w') as f:
    f.write(old_command)

print('\nOld CommandView saved to old_commandview.txt')