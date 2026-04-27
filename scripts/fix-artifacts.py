import glob
import json
import os
import re

# Regex for npm path conversion
NPM_RE = re.compile(r'^npm/((?:@[^/]+/)?([^@/]+))@[^/]+/')

def fix_path(path):
    if not isinstance(path, str):
        return path
    # 1. Convert npm/@scope/pkg@version/path -> node_modules/@scope/pkg/path
    path = NPM_RE.sub(r'node_modules/\1/', path)
    # 2. Convert project/path -> path
    if path.startswith('project/'):
        path = path[8:]
    return path

def transform_json(item):
    """Recursively updates keys and values in the JSON structure."""
    if isinstance(item, dict):
        return {fix_path(k): transform_json(v) for k, v in item.items()}
    elif isinstance(item, list):
        return [transform_json(i) for i in item]
    elif isinstance(item, str):
        return fix_path(item)
    return item

def process_artifacts():
    for input_file in glob.glob('artifacts/build-info/*.json'):
        if input_file.endswith('.output.json'):
            continue

        output_file = input_file.replace('.json', '.output.json')

        if os.path.exists(output_file):
            print(f"Processing: {os.path.basename(input_file)}")

            with open(input_file, 'r') as f:
                data = json.load(f)
            with open(output_file, 'r') as f:
                out_data = json.load(f)

            # 1. Merge output data
            data['output'] = out_data.get('output', out_data)

            # 2. Fix Hardhat version format string
            if data.get('_format', '').startswith('hh3-sol-build-info'):
                data['_format'] = 'hh-sol-build-info-1'

            # 3. Safely transform all paths in the object
            data = transform_json(data)

            # 4. Save the valid JSON back
            with open(input_file, 'w') as f:
                json.dump(data, f, indent=2)

            os.remove(output_file)

if __name__ == "__main__":
    process_artifacts()