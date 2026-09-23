import { assertArrangeVersionContract, readArrangeVersionContract } from "./version-contract.ts"

const contract = readArrangeVersionContract()
assertArrangeVersionContract()
console.log('[ArrangeVersion]', `verified Arrange version contract framework=${contract.frameworkVersion} frameworkProtocol=${contract.frameworkInternalProtocolCode} cli=${contract.cliVersion} cliCompatibility=${contract.cliCompatibility}`)
