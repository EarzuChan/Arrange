import {assertArrangeVersionContract, readArrangeVersionContract} from "./version-contract.ts"

const contract = readArrangeVersionContract()
assertArrangeVersionContract()
console.log(`verified Arrange version contract ${contract.version} protocol=${contract.protocolVersion}`)
