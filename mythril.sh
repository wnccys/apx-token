#!/bin/bash
# Recompile to ensure artifacts are up to date
npx hardhat compile --quiet

for CONTRACT_PATH in "$@"; do
    CONTRACT_NAME=$(basename "$CONTRACT_PATH" .sol)
    
    ARTIFACT_FILE="artifacts/$CONTRACT_PATH/$CONTRACT_NAME.json"
    
    if [ ! -f "$ARTIFACT_FILE" ]; then
        echo "Error: Artifact $ARTIFACT_FILE not found. Make sure the path is correct (e.g. contracts/Folder/Contract.sol)"
        continue
    fi
    
    echo "================================================="
    echo "Analyzing $CONTRACT_NAME via pre-compiled bytecode..."
    echo "================================================="
    
    # Extract deployed bytecode from the Hardhat artifact
    BYTECODE=$(node -e "const fs = require('fs'); const data = JSON.parse(fs.readFileSync('$ARTIFACT_FILE')); console.log(data.deployedBytecode);")
    
    # Remove the 0x prefix if present
    BYTECODE=${BYTECODE#0x}
    
    if [ -z "$BYTECODE" ] || [ "$BYTECODE" == "undefined" ]; then
        echo "Error: No deployedBytecode found for $CONTRACT_NAME"
        continue
    fi
    
    # Run mythril on the raw bytecode using Docker
    docker run --rm -v "$(pwd):/share" -w /share mythril/myth analyze -c "$BYTECODE"
done
