const fs = require('fs');
const content = fs.readFileSync('/home/jesus/Neurelix/NEO/apps/desktop/src/renderer/components/Modals/SettingsSections/StorageSection.tsx', 'utf8');

let stack = [];
let lines = content.split('\n');

for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    for (let j = 0; j < line.length; j++) {
        let char = line[j];
        if (char === '{') stack.push({char, line: i + 1});
        if (char === '}') {
            if (stack.length === 0 || stack[stack.length - 1].char !== '{') {
                console.log('Unbalanced } at line ' + (i + 1));
            } else {
                stack.pop();
            }
        }
        if (char === '(') stack.push({char, line: i + 1});
        if (char === ')') {
            if (stack.length === 0 || stack[stack.length - 1].char !== '(') {
                console.log('Unbalanced ) at line ' + (i + 1));
            } else {
                stack.pop();
            }
        }
    }
}

console.log('Final stack size:', stack.length);
if (stack.length > 0) {
    console.log('Open items:', stack);
}
