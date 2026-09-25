import ts from 'typescript'
import MagicString from 'magic-string'
import { validateValueUnits } from './valueUnits.ts'
import { parse } from './parse.ts'
import { generateSfaScript } from './compileScript.ts'
import { dirname, resolve } from 'node:path'
import { SourceMapConsumer, SourceMapGenerator, type RawSourceMap } from 'source-map-js'
import { normalizeSfaUnitSyntax, SFA_UNIT_SEPARATOR } from '../core/unitSyntax.ts'
import { modifierArgumentUnits, unitFieldContracts, type UnitFields, type ValueUnit } from '@arrange/shared'

const compilerOptions: ts.CompilerOptions = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true, noLib: true, skipLibCheck: true }

// 根据真实声明身份识别值壳，局部同名函数和参数遮蔽不会被改写
export function lowerSfaValues(content: string, filename: string, previousMap?: RawSourceMap): { content: string; map?: RawSourceMap; deps: string[] } {
    const entry = resolve(filename + '.ts')
    const normalizedEntry = normalizeSfaUnitSyntax(content)
    const configPath = ts.findConfigFile(dirname(entry), ts.sys.fileExists)
    const config = configPath ? ts.readConfigFile(configPath, ts.sys.readFile) : undefined
    const configured = configPath && config && !config.error ? ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath)).options : {}
    const options = { ...configured, ...compilerOptions, noLib: false, types: [] }
    const host = ts.createCompilerHost(options)
    const read = host.readFile.bind(host)
    const exists = host.fileExists.bind(host)
    const virtuals = new Map<string, string>()
    let colorModulePath: string | undefined
    const colorDeclarations = `
export type SfaColorChannels = Readonly<{ red: number; green: number; blue: number; alpha?: number }>
/** @arrangeValue color */
export type Color = number & {}
interface SfaColorFactory {
    /** @arrangeValue color */
    (value: number | SfaColorChannels): Color
    /** @arrangeValue color */
    hsl(hue: number, saturation: number, lightness: number, alpha?: number): Color
}
/** @arrangeValue color */
export declare const Color: SfaColorFactory
`
    const analysisPrelude = "\nimport * as __ArrangeUnitsFoundation from '@arrange/framework/foundation'\nimport * as __Foundation from '@arrange/framework/foundation'\n/** @arrangeCheckProps */\ndeclare function __arrangeCheck(...args: any[]): any\n"
    host.readFile = file => {
        if (resolve(file) === entry) return normalizedEntry.content + analysisPrelude
        if (colorModulePath && resolve(file) === colorModulePath) return `${read(file) ?? ''}${colorDeclarations}`
        if (!file.endsWith('.sfa.ts')) return read(file)
        const cached = virtuals.get(file)
        if (cached !== undefined) return cached
        const sfaFile = file.slice(0, -3)
        const text = read(sfaFile)
        if (text === undefined) return undefined
        const parsed = parse(text, { filename: sfaFile })
        if (parsed.errors.length) throw parsed.errors[0]
        const descriptor = parsed.descriptor.script ? parsed.descriptor : parse(text + '\n<script></script>', { filename: sfaFile }).descriptor
        const script = generateSfaScript(descriptor, {})
        const normalized = normalizeSfaUnitSyntax(script.content).content
        virtuals.set(file, normalized)
        return normalized
    }
    host.fileExists = file => resolve(file) === entry || (file.endsWith('.sfa.ts') ? exists(file.slice(0, -3)) : exists(file))
    host.resolveModuleNames = (names, containing) => names.map(name => {
        const resolved = ts.resolveModuleName(name.endsWith('.sfa') ? name + '.ts' : name, containing, options, host).resolvedModule
        if (name === '@arrange/framework/ui' && resolved) colorModulePath = resolve(resolved.resolvedFileName)
        return resolved
    })
    host.getSourceFile = (file, version) => {
        const text = host.readFile(file)
        return text === undefined ? undefined : ts.createSourceFile(file, text, version, true)
    }

    const program = ts.createProgram([entry], options, host)
    const checker = program.getTypeChecker()
    const source = program.getSourceFile(entry)!
    const deps = program.getSourceFiles().filter(file => file !== source && !program.isSourceFileDefaultLibrary(file) && !file.fileName.replaceAll('\\', '/').includes('/node_modules/')).map(file => file.fileName.endsWith('.sfa.ts') ? file.fileName.slice(0, -3) : file.fileName)
    const output = new MagicString(normalizedEntry.content)
    type LengthCapture = { name: string; text: string }
    type LengthPair = { dp: string; px: string; captures: readonly LengthCapture[] }
    const unitCaptureNames = new Set<string>()
    type Rule = ValueUnit | UnitFields

    const textOf = (node: ts.Node): string => source.text.slice(node.getStart(source), node.end).replaceAll(SFA_UNIT_SEPARATOR, '')
    const numeric = (value: string): number | undefined => {
        const text = value.trim()
        if (!/^[+-]?(?:(?:\d[\d_]*(?:\.\d[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d[\d_]*)?|0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+)$/.test(text)) return
        const result = Number(text.replaceAll('_', ''))
        return Number.isFinite(result) ? result : undefined
    }
    const folded = (value: number): string => String(Object.is(value, -0) ? 0 : value)
    const unwrap = (node: ts.Expression): ts.Expression => {
        if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node)) return unwrap(node.expression)
        return node
    }
    const unitAccess = (node: ts.Expression): node is ts.PropertyAccessExpression => {
        return ts.isPropertyAccessExpression(node) && ['dp', 'px', 'sp'].includes(node.name.text) && !checker.getTypeAtLocation(node.expression).getProperty(node.name.text)
    }
    const zero = (value: string): boolean => value === '0'
    const add = (left: string, right: string, operator: '+' | '-'): string => {
        const leftNumber = numeric(left)
        const rightNumber = numeric(right)
        if (leftNumber !== undefined && rightNumber !== undefined) return folded(operator === '+' ? leftNumber + rightNumber : leftNumber - rightNumber)
        if (zero(left)) return operator === '+' ? right : `-(${right})`
        if (zero(right)) return left
        return `(${left}) ${operator} (${right})`
    }
    const scale = (value: string, operator: '*' | '/', factor: string): string => {
        if (zero(value)) return '0'
        const valueNumber = numeric(value)
        const factorNumber = numeric(factor)
        if (valueNumber !== undefined && factorNumber !== undefined) return folded(operator === '*' ? valueNumber * factorNumber : valueNumber / factorNumber)
        return `(${value}) ${operator} (${factor})`
    }

    type Scalar = { text: string; value?: number }
    type ColorChannels = { red: Scalar; green: Scalar; blue: Scalar; alpha: Scalar; base?: { name: string; text: string } }

    const numericExpression = (node: ts.Expression, seen = new Set<ts.Node>()): number | undefined => {
        const value = unwrap(node)
        if (seen.has(value)) return
        seen.add(value)

        const literal = numeric(textOf(value))
        if (literal !== undefined) return literal

        if (ts.isPrefixUnaryExpression(value) && (value.operator === ts.SyntaxKind.PlusToken || value.operator === ts.SyntaxKind.MinusToken)) {
            const operand = numericExpression(value.operand, seen)
            return operand === undefined ? undefined : value.operator === ts.SyntaxKind.PlusToken ? operand : -operand
        }

        if (ts.isBinaryExpression(value)) {
            const left = numericExpression(value.left, seen)
            const right = numericExpression(value.right, seen)
            if (left === undefined || right === undefined) return
            switch (value.operatorToken.kind) {
                case ts.SyntaxKind.PlusToken: return left + right
                case ts.SyntaxKind.MinusToken: return left - right
                case ts.SyntaxKind.AsteriskToken: return left * right
                case ts.SyntaxKind.SlashToken: return right === 0 ? undefined : left / right
                case ts.SyntaxKind.PercentToken: return right === 0 ? undefined : left % right
                case ts.SyntaxKind.AsteriskAsteriskToken: return left ** right
            }
        }

        const declaration = checker.getSymbolAtLocation(value)?.valueDeclaration
        if (declaration && declaration.getSourceFile() === source && ts.isVariableDeclaration(declaration) && (declaration.parent.flags & ts.NodeFlags.Const) !== 0 && declaration.initializer) return numericExpression(declaration.initializer, seen)

        return
    }

    const scalar = (node: ts.Expression): Scalar => {
        const value = numericExpression(node)
        return value !== undefined && Number.isFinite(value) ? { text: folded(value), value } : { text: textOf(node) }
    }

    const isUndefined = (node: ts.Expression): boolean => {
        const value = unwrap(node)
        return ts.isIdentifier(value) && value.text === 'undefined' || ts.isVoidExpression(value)
    }

    const staticColorError = (message: string): never => {
        throw new Error(`${filename}：${message}`)
    }

    const colorByte = (value: Scalar, name: string): Scalar => {
        if (value.value !== undefined) {
            if (value.value < 0 || value.value > 1) staticColorError(`Color 的 ${name} 通道必须在 0..1 之间`)
            return { text: folded(Math.round(value.value * 255)), value: Math.round(value.value * 255) }
        }
        return { text: `Math.round((${value.text}) * 255)` }
    }

    const packArgb = (channels: ColorChannels): string => {
        const alphaValue = channels.alpha.value === undefined ? { text: `(${channels.alpha.text}) ?? 1` } : channels.alpha
        const values = [
            ['alpha', alphaValue],
            ['red', channels.red],
            ['green', channels.green],
            ['blue', channels.blue],
        ] as const

        if (values.every(([, value]) => value.value !== undefined)) {
            const alpha = colorByte(alphaValue, 'alpha')
            const red = colorByte(channels.red, 'red')
            const green = colorByte(channels.green, 'green')
            const blue = colorByte(channels.blue, 'blue')
            return folded(((alpha.value! << 24) | (red.value! << 16) | (green.value! << 8) | blue.value!) >>> 0)
        }

        const names = {
            alpha: uniqueName(content, '__arrangeColorAlphaValue'),
            red: uniqueName(content, '__arrangeColorRedValue'),
            green: uniqueName(content, '__arrangeColorGreenValue'),
            blue: uniqueName(content, '__arrangeColorBlueValue'),
        }
        const base = channels.base ? `const ${channels.base.name} = (${channels.base.text}); ` : ''
        const declarations = values.map(([name, value]) => `const ${names[name]} = (${value.text});`).join(' ')
        const finiteChecks = values.map(([name]) => `if (!Number.isFinite(${names[name]})) throw new TypeError('Color 的 ${name} 通道必须是有限数值');`).join(' ')
        const rangeChecks = values.map(([name]) => `if (${names[name]} < 0 || ${names[name]} > 1) throw new RangeError('Color 的 ${name} 通道必须在 0..1 之间');`).join(' ')
        return `(() => { ${base}${declarations} ${finiteChecks} ${rangeChecks} return ((Math.round(${names.alpha} * 255) << 24) | (Math.round(${names.red} * 255) << 16) | (Math.round(${names.green} * 255) << 8) | Math.round(${names.blue} * 255)) >>> 0 })()`
    }

    const isStaticColor = (channels: ColorChannels): boolean => [channels.red, channels.green, channels.blue, channels.alpha].every(channel => channel.value !== undefined)

    const colorObject = (input: ts.Expression, seen = new Set<ts.Node>()): ColorChannels | undefined => {
        const node = unwrap(input)
        if (seen.has(node)) return
        seen.add(node)

        if (!ts.isObjectLiteralExpression(node)) {
            if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(source) === 'Object' && node.expression.name.text === 'freeze' && node.arguments.length === 1) {
                const argument = unwrap(node.arguments[0])
                if (ts.isObjectLiteralExpression(argument)) return colorObject(argument, seen)
            }

            if (isUnrefCall(node)) {
                const argument = unwrap(node.arguments[0])
                if (ts.isObjectLiteralExpression(argument)) return colorObject(argument, seen)
            }

            const declaration = checker.getSymbolAtLocation(node)?.valueDeclaration
            if (declaration && declaration.getSourceFile() === source && ts.isVariableDeclaration(declaration) && (declaration.parent.flags & ts.NodeFlags.Const) !== 0 && declaration.initializer && ts.isObjectLiteralExpression(unwrap(declaration.initializer))) {
                const resolved = colorObject(unwrap(declaration.initializer), new Set(seen))
                if (resolved && isStaticColor(resolved)) return resolved
            }

            const type = checker.getTypeAtLocation(node)
            if (!type.getProperty('red') || !type.getProperty('green') || !type.getProperty('blue')) return
            const baseName = uniqueName(content, '__arrangeColorChannels')
            const base = `(${textOf(node)})`
            const alpha = type.getProperty('alpha') ? { text: `${baseName}.alpha ?? 1` } : { text: '1', value: 1 }
            return {
                red: { text: `${baseName}.red` },
                green: { text: `${baseName}.green` },
                blue: { text: `${baseName}.blue` },
                alpha,
                base: { name: baseName, text: base },
            }
        }

        const values = new Map<string, ts.Expression>()
        for (const property of node.properties) {
            if (ts.isSpreadAssignment(property)) return
            if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) return
            const name = property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) ? property.name.text : undefined
            if (!name) return
            values.set(name, ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer)
        }

        const red = values.get('red')
        const green = values.get('green')
        const blue = values.get('blue')
        if (!red || !green || !blue) return
        const alpha = values.get('alpha')
        return { red: scalar(red), green: scalar(green), blue: scalar(blue), alpha: !alpha || isUndefined(alpha) ? { text: '1', value: 1 } : scalar(alpha) }
    }

    const hslArgb = (hue: Scalar, saturation: Scalar, lightness: Scalar, alpha: Scalar): string => {
        if ([hue, saturation, lightness, alpha].every(value => value.value !== undefined)) {
            const hueValue = hue.value!
            const saturationValue = saturation.value!
            const lightnessValue = lightness.value!
            const alphaValue = alpha.value!
            if (saturationValue < 0 || saturationValue > 1 || lightnessValue < 0 || lightnessValue > 1 || alphaValue < 0 || alphaValue > 1) staticColorError('Color.hsl 的饱和度、亮度和透明度必须在 0..1 之间')

            const h = ((hueValue % 360) + 360) % 360 / 360
            const chroma = (1 - Math.abs(2 * lightnessValue - 1)) * saturationValue
            const segment = h * 6
            const x = chroma * (1 - Math.abs(segment % 2 - 1))
            const [red, green, blue] = segment < 1 ? [chroma, x, 0] : segment < 2 ? [x, chroma, 0] : segment < 3 ? [0, chroma, x] : segment < 4 ? [0, x, chroma] : segment < 5 ? [x, 0, chroma] : [chroma, 0, x]
            const offset = lightnessValue - chroma / 2
            return packArgb({ red: { text: folded(red + offset), value: red + offset }, green: { text: folded(green + offset), value: green + offset }, blue: { text: folded(blue + offset), value: blue + offset }, alpha })
        }

        const hueText = hue.text
        const saturationText = saturation.text
        const lightnessText = lightness.text
        const alphaText = alpha.value === undefined ? `((${alpha.text}) ?? 1)` : alpha.text
        const hueName = uniqueName(content, '__arrangeColorHue')
        const saturationName = uniqueName(content, '__arrangeColorSaturation')
        const lightnessName = uniqueName(content, '__arrangeColorLightness')
        const alphaName = uniqueName(content, '__arrangeColorAlpha')
        const normalizedHueName = uniqueName(content, '__arrangeColorNormalizedHue')
        const chromaName = uniqueName(content, '__arrangeColorChroma')
        const segmentName = uniqueName(content, '__arrangeColorSegment')
        const auxiliaryName = uniqueName(content, '__arrangeColorAuxiliary')
        const offsetName = uniqueName(content, '__arrangeColorOffset')
        const redName = uniqueName(content, '__arrangeColorRed')
        const greenName = uniqueName(content, '__arrangeColorGreen')
        const blueName = uniqueName(content, '__arrangeColorBlue')
        return `(() => { const ${hueName} = (${hueText}); const ${saturationName} = (${saturationText}); const ${lightnessName} = (${lightnessText}); const ${alphaName} = ${alphaText}; if (!Number.isFinite(${hueName})) throw new TypeError('Color.hsl 的色相必须是有限数值'); if (!Number.isFinite(${saturationName}) || !Number.isFinite(${lightnessName}) || !Number.isFinite(${alphaName})) throw new TypeError('Color.hsl 的饱和度、亮度和透明度必须是有限数值'); if (${saturationName} < 0 || ${saturationName} > 1 || ${lightnessName} < 0 || ${lightnessName} > 1 || ${alphaName} < 0 || ${alphaName} > 1) throw new RangeError('Color.hsl 的饱和度、亮度和透明度必须在 0..1 之间'); const ${normalizedHueName} = ((${hueName} % 360) + 360) % 360 / 360; const ${chromaName} = (1 - Math.abs(2 * ${lightnessName} - 1)) * ${saturationName}; const ${segmentName} = ${normalizedHueName} * 6; const ${auxiliaryName} = ${chromaName} * (1 - Math.abs(${segmentName} % 2 - 1)); const ${offsetName} = ${lightnessName} - ${chromaName} / 2; const ${redName} = ${segmentName} < 1 ? ${chromaName} : ${segmentName} < 2 ? ${auxiliaryName} : ${segmentName} < 3 ? 0 : ${segmentName} < 4 ? 0 : ${segmentName} < 5 ? ${auxiliaryName} : ${chromaName}; const ${greenName} = ${segmentName} < 1 ? ${auxiliaryName} : ${segmentName} < 2 ? ${chromaName} : ${segmentName} < 3 ? ${chromaName} : ${segmentName} < 4 ? ${auxiliaryName} : 0; const ${blueName} = ${segmentName} < 1 ? 0 : ${segmentName} < 2 ? 0 : ${segmentName} < 3 ? ${auxiliaryName} : ${segmentName} < 4 ? ${chromaName} : ${segmentName} < 5 ? ${chromaName} : ${auxiliaryName}; return (((Math.round(${alphaName} * 255) << 24) | (Math.round((${redName} + ${offsetName}) * 255) << 16) | (Math.round((${greenName} + ${offsetName}) * 255) << 8) | Math.round((${blueName} + ${offsetName}) * 255))) >>> 0 })()`
    }

    const colorExpression = (node: ts.CallExpression): string => {
        const isHsl = ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'hsl'
        if (isHsl) {
            if (node.arguments.length < 3 || node.arguments.length > 4 || node.arguments.some(ts.isSpreadElement)) staticColorError('Color.hsl 需要三个或四个明确参数')
            const alpha = node.arguments[3]
            return hslArgb(scalar(node.arguments[0]), scalar(node.arguments[1]), scalar(node.arguments[2]), !alpha || isUndefined(alpha) ? { text: '1', value: 1 } : scalar(alpha))
        }

        if (node.arguments.length !== 1 || ts.isSpreadElement(node.arguments[0])) staticColorError('Color 值需要一个明确参数')
        const argument = node.arguments[0]
        const channels = colorObject(argument)
        if (channels) return packArgb(channels)

        const value = numericExpression(argument)
        if (value !== undefined) {
            if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) staticColorError('Color 的 ARGB 数值必须是 uint32 整数')
            return folded(value)
        }

        if (ts.isObjectLiteralExpression(unwrap(argument))) staticColorError('Color 通道对象必须包含 red、green 和 blue')

        if (ts.isCallExpression(argument) && expressionKind(argument.expression) === 'color') return colorExpression(argument)

        const type = checker.getTypeAtLocation(argument)
        if (type.flags & (ts.TypeFlags.NumberLike | ts.TypeFlags.NumberLiteral)) return `(${textOf(argument)})`

        const name = uniqueName(content, '__arrangeColorValue')
        const base = `(${textOf(argument)})`
        const packed = packArgb({
            red: { text: `${name}.red` },
            green: { text: `${name}.green` },
            blue: { text: `${name}.blue` },
            alpha: { text: `${name}.alpha ?? 1` },
        })
        return `(() => { const ${name} = ${base}; return typeof ${name} === 'number' ? ${name} : ${packed} })()`
    }

    const lengthParts = (input: ts.Expression, seen = new Set<ts.Node>(), captures = new Map<ts.Node, LengthCapture>()): LengthPair | undefined => {
        const makePair = (dp: string, px: string): LengthPair => ({ dp, px, captures: [...captures.values()] })
        const capture = (node: ts.Node): string => {
            const existing = captures.get(node)
            if (existing) return existing.name

            let name = uniqueName(content, '__arrangeUnitValue')
            while (unitCaptureNames.has(name)) name += '_'
            unitCaptureNames.add(name)
            const created = { name, text: textOf(node) }
            captures.set(node, created)
            return created.name
        }

        const node = unwrap(input)
        if (seen.has(node)) return
        seen.add(node)

        if (unitAccess(node) && (node.name.text === 'dp' || node.name.text === 'px')) {
            const value = textOf(node.expression)
            return node.name.text === 'dp' ? makePair(value, '0') : makePair('0', value)
        }

        if (isUnrefCall(node)) {
            const kind = expressionKind(node.arguments[0])
            if (kind === 'dp' || kind === 'px') return kind === 'dp' ? makePair(textOf(node), '0') : makePair('0', textOf(node))
        }

        if (ts.isCallExpression(node) && node.arguments.length === 1) {
            const kind = expressionKind(node.expression)
            if (kind === 'dp' || kind === 'px') {
                const value = textOf(node.arguments[0])
                return kind === 'dp' ? makePair(value, '0') : makePair('0', value)
            }
        }

        if (ts.isBinaryExpression(node)) {
            const left = lengthParts(node.left, new Set(seen), captures)
            const right = lengthParts(node.right, new Set(seen), captures)
            if (node.operatorToken.kind === ts.SyntaxKind.PlusToken || node.operatorToken.kind === ts.SyntaxKind.MinusToken) {
                if (!left || !right) return
                const operator = node.operatorToken.kind === ts.SyntaxKind.PlusToken ? '+' : '-'
                return makePair(add(left.dp, right.dp, operator), add(left.px, right.px, operator))
            }
            if (node.operatorToken.kind === ts.SyntaxKind.AsteriskToken || node.operatorToken.kind === ts.SyntaxKind.SlashToken) {
                if (left && !right) {
                    const factor = left.dp !== '0' && left.px !== '0' ? capture(node.right) : textOf(node.right)
                    const operator = node.operatorToken.kind === ts.SyntaxKind.AsteriskToken ? '*' : '/'
                    return makePair(scale(left.dp, operator, factor), scale(left.px, operator, factor))
                }
                if (!left && right && node.operatorToken.kind === ts.SyntaxKind.AsteriskToken) {
                    const factor = right.dp !== '0' && right.px !== '0' ? capture(node.left) : textOf(node.left)
                    return makePair(scale(right.dp, '*', factor), scale(right.px, '*', factor))
                }
                return
            }
        }

        if (ts.isConditionalExpression(node)) {
            const whenTrue = lengthParts(node.whenTrue, new Set(seen), captures)
            const whenFalse = lengthParts(node.whenFalse, new Set(seen), captures)
            if (!whenTrue || !whenFalse) return
            const conditionText = textOf(node.condition)
            const condition = conditionText === 'true' || conditionText === 'false' ? conditionText : capture(node.condition)
            return makePair(`(${condition}) ? (${whenTrue.dp}) : (${whenFalse.dp})`, `(${condition}) ? (${whenTrue.px}) : (${whenFalse.px})`)
        }

        if (ts.isPrefixUnaryExpression(node)) {
            const value = lengthParts(node.operand, new Set(seen), captures)
            if (!value) return
            if (node.operator === ts.SyntaxKind.PlusToken) return makePair(value.dp, value.px)
            if (node.operator === ts.SyntaxKind.MinusToken) return makePair(`-(${value.dp})`, `-(${value.px})`)
            return
        }

        if (ts.isPropertyAccessExpression(node) && node.name.text === 'value') {
            const declaration = checker.getSymbolAtLocation(node.expression)?.valueDeclaration
            const initializer = declaration && (ts.isVariableDeclaration(declaration) || ts.isPropertyAssignment(declaration)) && declaration.getSourceFile() === source ? declaration.initializer : undefined
            if (initializer && ts.isCallExpression(initializer) && initializer.arguments.length === 1) {
                const kind = expressionKind(initializer.arguments[0])
                if (kind === 'dp' || kind === 'px') return kind === 'dp' ? makePair(textOf(node), '0') : makePair('0', textOf(node))
            }
        }

        const known = expressionKind(node) ?? propertyUnit(node)
        if (known === 'dp' || known === 'px') return known === 'dp' ? makePair(textOf(node), '0') : makePair('0', textOf(node))

        const declaration = checker.getSymbolAtLocation(node)?.valueDeclaration
        if (declaration && declaration.getSourceFile() === source && (ts.isVariableDeclaration(declaration) || ts.isPropertyAssignment(declaration)) && declaration.initializer) {
            if (ts.isCallExpression(declaration.initializer) && declaration.initializer.arguments.length === 1) {
                const pair = lengthParts(declaration.initializer.arguments[0], new Set(seen), captures)
                if (pair) return pair
            }
            return lengthParts(declaration.initializer, new Set(seen), captures)
        }

        return
    }

    const lowerObject = (node: ts.Expression, fields: UnitFields): void => {
        const object = unwrap(node)
        if (!ts.isObjectLiteralExpression(object)) {
            const owner = ts.isPropertyAccessExpression(object) && object.name.text === 'value' ? object.expression : object
            const declaration = checker.getSymbolAtLocation(owner)?.valueDeclaration
            if (declaration && declaration.getSourceFile() === source && (ts.isVariableDeclaration(declaration) || ts.isPropertyAssignment(declaration)) && declaration.initializer && declaration.initializer !== object) {
                if (ts.isPropertyAccessExpression(object) && object.name.text === 'value' && ts.isCallExpression(declaration.initializer) && declaration.initializer.arguments.length === 1) {
                    lowerObject(declaration.initializer.arguments[0], fields)
                    return
                }

                lowerObject(declaration.initializer, fields)
                return
            }

            if (ts.isCallExpression(object) && ts.isPropertyAccessExpression(object.expression) && object.expression.expression.getText(source) === 'Object' && object.expression.name.text === 'freeze' && object.arguments.length === 1) {
                lowerObject(object.arguments[0], fields)
                return
            }

            if (isUnrefCall(object)) {
                lowerObject(object.arguments[0], fields)
                return
            }

            visit(node)
            return
        }
        for (const property of object.properties) {
            if (ts.isSpreadAssignment(property)) {
                visit(property.expression)
                continue
            }
            if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) continue
            const name = property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name)) ? property.name.text : undefined
            if (!name || !fields[name]) continue
            const field = fields[name]
            const value = ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer
            if (field === 'length') {
                const pair = lengthParts(value)
                if (!pair) throw new Error(`${filename}：单位字段 ${name} 需要由 DP/PX 表达式组成`)
                output.overwrite(property.getStart(source), property.end, renderLengthFields(name, pair))
            } else if (typeof field === 'object') lowerObject(value, field)
            else visit(value)
        }
    }

    const renderLengthPair = (pair: LengthPair): string => {
        if (!pair.captures.length) return `${pair.dp}, ${pair.px}`
        const declarations = pair.captures.map(capture => `const ${capture.name} = (${capture.text})`).join('; ')
        return `...(() => { ${declarations}; return [${pair.dp}, ${pair.px}] })()`
    }

    const renderLengthFields = (name: string, pair: LengthPair): string => {
        if (!pair.captures.length) return `${name}Dp: ${pair.dp}, ${name}Px: ${pair.px}`
        const declarations = pair.captures.map(capture => `const ${capture.name} = (${capture.text})`).join('; ')
        return `...(() => { ${declarations}; return { ${name}Dp: ${pair.dp}, ${name}Px: ${pair.px} } })()`
    }

    const lowerArguments = (argumentsList: readonly ts.Expression[], rules: readonly (Rule | undefined)[] | Rule): void => {
        const list = Array.isArray(rules) ? rules : [rules]
        for (const [index, rule] of list.entries()) {
            const argument = argumentsList[index]
            if (!argument || !rule) continue
            if (rule === 'length') {
                const pair = lengthParts(argument)
                if (!pair) throw new Error(`${filename}：单位参数 ${textOf(argument)} 需要由 DP/PX 表达式组成`)
                output.overwrite(argument.getStart(source), argument.end, renderLengthPair(pair))
            } else if (typeof rule === 'object') lowerObject(argument, rule)
            else visit(argument)
        }
    }

    const argumentRules = (call: ts.CallExpression): readonly (Rule | undefined)[] | undefined => {
        const node = call.expression
        let symbol = checker.getSymbolAtLocation(node)
        if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
        const declarations = [...symbol?.declarations ?? []]
        const signature = checker.getResolvedSignature(call)?.declaration
        if (signature && !declarations.includes(signature)) declarations.push(signature)
        const comment = declarations.map(declaration => ts.getJSDocTags(declaration).find(tag => tag.tagName.text === 'arrangeArguments')?.comment).find(value => typeof value === 'string')
        if (typeof comment !== 'string') return
        return comment.trim().split(/\s+/).map(name => name === 'none' ? undefined : name as ValueUnit)
    }
    const hasTag = (node: ts.Node, name: string): boolean => {
        let symbol = checker.getSymbolAtLocation(node)
        if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
        return !!symbol?.declarations?.some(declaration => ts.getJSDocTags(declaration).some(tag => tag.tagName.text === name))
    }

    const isUnrefCall = (node: ts.Expression): node is ts.CallExpression => {
        if (!ts.isCallExpression(node) || node.arguments.length !== 1) return false
        if (hasTag(node.expression, 'arrangeUnref')) return true
        if (!ts.isIdentifier(node.expression)) return false
        const symbol = checker.getSymbolAtLocation(node.expression)
        return !!symbol?.declarations?.some(declaration => {
            if (!ts.isImportSpecifier(declaration)) return false
            const imported = declaration.propertyName ?? declaration.name
            return ts.isIdentifier(imported) && imported.text === 'unref'
        })
    }

    const isModifierMethodCall = (node: ts.CallExpression): boolean => {
        const declarations = checker.getSymbolAtLocation(node.expression)?.declarations ?? []
        if (declarations.some(declaration => ts.isMethodDeclaration(declaration) && ts.getJSDocTags(declaration.parent).some(tag => tag.tagName.text === 'arrangeModifier'))) return true
        const declaration = checker.getResolvedSignature(node)?.declaration
        return !!declaration && ts.isMethodDeclaration(declaration) && ts.getJSDocTags(declaration.parent).some(tag => tag.tagName.text === 'arrangeModifier')
    }

    const valueKind = (symbol: ts.Symbol | undefined): string | undefined => {
        if (!symbol) return
        if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
        for (const declaration of symbol.declarations ?? []) {
            const tag = ts.getJSDocTags(declaration).find(tag => tag.tagName.text === 'arrangeValue')
            if (typeof tag?.comment === 'string') return tag.comment.trim()
        }
    }

    const typeUnit = (type: ts.Type): ValueUnit | undefined => {
        const symbolUnit = valueKind(type.aliasSymbol) ?? valueKind(type.symbol)
        if (symbolUnit === 'dp' || symbolUnit === 'px' || symbolUnit === 'sp' || symbolUnit === 'color') return symbolUnit
        const unit = type.getProperty('unit')
        if (!unit) return
        const literal = checker.getTypeOfSymbolAtLocation(unit, source)
        return literal.isStringLiteral() && (literal.value === 'dp' || literal.value === 'px' || literal.value === 'sp' || literal.value === 'color') ? literal.value : undefined
    }

    const fieldsUnit = (type: ts.Type, name: string): ValueUnit | undefined => {
        for (const declaration of [...type.aliasSymbol?.declarations ?? [], ...type.symbol?.declarations ?? []]) {
            const tag = ts.getJSDocTags(declaration).find(item => item.tagName.text === 'arrangeFields')
            if (typeof tag?.comment === 'string') {
                const fields = unitFieldContracts[tag.comment.trim()]
                const unit = fields?.[name]
                return typeof unit === 'string' ? unit : undefined
            }
        }
        return type.isUnion() ? type.types.map(item => fieldsUnit(item, name)).find(Boolean) : undefined
    }

    const propertyUnit = (node: ts.Expression): ValueUnit | undefined => ts.isPropertyAccessExpression(node) ? fieldsUnit(checker.getTypeAtLocation(node.expression), node.name.text) : undefined

    const propertyNameText = (propertyName: ts.Node | undefined): string | undefined => {
        if (!propertyName) return
        if (ts.isIdentifier(propertyName) || ts.isStringLiteral(propertyName) || ts.isNumericLiteral(propertyName)) return propertyName.text
        if (ts.isComputedPropertyName(propertyName) && ts.isStringLiteralLike(propertyName.expression)) return propertyName.expression.text
    }

    const expressionKind = (node: ts.Expression, seen = new Set<ts.Node>()): string | undefined => {
        if (seen.has(node)) return
        seen.add(node)
        if (ts.isParenthesizedExpression(node)) return expressionKind(node.expression, seen)
        if (unitAccess(node)) return node.name.text
        if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
            const property = checker.getTypeAtLocation(node.expression).getProperty(node.argumentExpression.text)
            const propertyKind = valueKind(property)
            if (propertyKind) return propertyKind
        }
        if (isUnrefCall(node)) return expressionKind(node.arguments[0], new Set(seen))
        const symbol = checker.getSymbolAtLocation(node)
        const kind = valueKind(symbol)
        if (kind) return kind
        const typed = typeUnit(checker.getTypeAtLocation(node))
        if (typed) return typed
        const declaration = symbol?.valueDeclaration
        if (declaration && ts.isBindingElement(declaration)) {
            const name = propertyNameText(declaration.propertyName ?? declaration.name)
            const pattern = declaration.parent
            const variable = pattern.parent
            if (name && ts.isObjectBindingPattern(pattern) && ts.isVariableDeclaration(variable) && variable.initializer) {
                const property = checker.getTypeAtLocation(variable.initializer).getProperty(name)
                const propertyKind = valueKind(property)
                if (propertyKind) return propertyKind
            }
        }
        if (declaration?.getSourceFile() === source && (ts.isVariableDeclaration(declaration) || ts.isPropertyAssignment(declaration)) && declaration.initializer) return expressionKind(declaration.initializer, seen)
    }

    const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
            if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && isModifierMethodCall(node)) {
                const method = node.expression.name.text
                const rules = Object.hasOwn(modifierArgumentUnits, method) ? modifierArgumentUnits[method] : undefined
                if (rules) {
                    if (method === 'padding' && node.arguments.length === 1 && lengthParts(node.arguments[0])) {
                        const pair = lengthParts(node.arguments[0])!
                        output.overwrite(node.arguments[0].getStart(source), node.arguments[0].end, renderLengthPair(pair))
                    } else lowerArguments(node.arguments, rules)
                    visit(node.expression.expression)
                    return
                }
            }

            if (ts.isCallExpression(node) && expressionKind(node.expression) === undefined) {
                const rules = argumentRules(node)
                if (rules) {
                    lowerArguments(node.arguments, rules)
                    visit(node.expression)
                    return
                }
            }

            if (ts.isCallExpression(node) && expressionKind(node.expression) === undefined && hasTag(node.expression, 'arrangeModifierCall') && node.arguments[1] && ts.isArrayLiteralExpression(node.arguments[1])) {
                for (const segment of node.arguments[1].elements) {
                    if (!ts.isArrayLiteralExpression(segment) || !ts.isStringLiteral(segment.elements[0]) || !ts.isArrowFunction(segment.elements[1])) continue
                    const body = segment.elements[1].body
                    const name = segment.elements[0].text
                    const rules = Object.hasOwn(modifierArgumentUnits, name) ? modifierArgumentUnits[name] : undefined
                    if (rules && ts.isArrayLiteralExpression(body)) {
                        const argumentsList = body.elements.filter((entry): entry is ts.Expression => !ts.isSpreadElement(entry))
                        if (name === 'padding' && argumentsList.length === 1 && lengthParts(argumentsList[0])) {
                            const pair = lengthParts(argumentsList[0])!
                            output.overwrite(argumentsList[0].getStart(source), argumentsList[0].end, renderLengthPair(pair))
                        } else lowerArguments(argumentsList, rules)
                    }
                }
                return
            }

            const kind = expressionKind(node.expression)
            if (kind) {
                if (kind === 'color' && ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'hsl') {
                    output.overwrite(node.getStart(source), node.end, colorExpression(node))
                    return
                }
                if (node.arguments?.length !== 1 || ts.isSpreadElement(node.arguments[0])) throw new Error(`${filename}：${kind} 值壳必须提供一个明确的参数`)
                const argument = node.arguments[0]
                if (kind === 'color' && ts.isCallExpression(node)) {
                    output.overwrite(node.getStart(source), node.end, colorExpression(node))
                } else output.overwrite(node.getStart(source), argument.getStart(source), '(')
                if (kind !== 'color' || !ts.isCallExpression(node)) {
                    output.overwrite(argument.end, node.end, ')')
                    visit(argument)
                }
                return
            }
        }

        if (ts.isTypeReferenceNode(node) && valueKind(checker.getSymbolAtLocation(node.typeName))) {
            output.overwrite(node.getStart(source), node.end, 'number')
            return
        }

        // 值壳作为运行时 prop 构造声明时，拆壳后的真实类型是 Number
        if ((ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) && ts.isPropertyAssignment(node.parent) && node.parent.initializer === node) {
            let symbol = checker.getSymbolAtLocation(node)
            if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
            if (valueKind(symbol) && symbol?.declarations?.some(ts.isClassDeclaration)) {
                output.overwrite(node.getStart(source), node.end, 'Number')
                return
            }
        }

        if (ts.isPropertyAccessExpression(node) && unitAccess(node)) {
            output.overwrite(node.getStart(source), node.end, textOf(node.expression))
            visit(node.expression)
            return
        }

        if (ts.isAsExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Object' && ts.isTypeReferenceNode(node.type) && node.type.typeArguments?.length === 1) {
            const type = checker.getTypeFromTypeNode(node.type.typeArguments[0])
            if (valueKind(type.symbol)) output.overwrite(node.expression.getStart(source), node.expression.end, 'Number')
        }

        if (ts.isPropertyAccessExpression(node) && node.name.text === 'value' && valueKind(checker.getTypeAtLocation(node.expression).symbol)) {
            output.remove(node.expression.end, node.end)
            visit(node.expression)
            return
        }

        ts.forEachChild(node, child => { if (child.getStart(source) < normalizedEntry.content.length) visit(child) })
    }

    const removeColorImports = (): void => {
        const resolveSymbol = (node: ts.Node): ts.Symbol | undefined => {
            let symbol = checker.getSymbolAtLocation(node)
            if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
            return symbol
        }

        const isColorSymbol = (node: ts.Node): boolean => valueKind(resolveSymbol(node)) === 'color'

        const isColorBinding = (binding: ts.BindingElement): boolean => {
            if (!ts.isIdentifier(binding.name) && !ts.isStringLiteral(binding.name)) return false
            if (expressionKind(binding.name as ts.Identifier) === 'color') return true

            const pattern = binding.parent
            if (!ts.isObjectBindingPattern(pattern)) return false
            const declaration = pattern.parent
            if (!ts.isVariableDeclaration(declaration)) return false

            const name = propertyNameText(binding.propertyName ?? binding.name)
            if (!name) return false

            const declarationList = declaration.parent
            const owner = declarationList.parent
            const sourceType = declaration.initializer ? checker.getTypeAtLocation(declaration.initializer) : ts.isForOfStatement(owner) ? checker.getIndexTypeOfType(checker.getTypeAtLocation(owner.expression), ts.IndexKind.Number) : undefined
            return !!sourceType && valueKind(sourceType.getProperty(name)) === 'color'
        }

        const isColorFactoryUse = (node: ts.Node): boolean => {
            const parent = node.parent
            if (ts.isCallExpression(parent) && parent.expression === node) return true
            if (ts.isCallExpression(parent) && parent.arguments.length === 1 && parent.arguments[0] === node && hasTag(parent.expression, 'arrangeUnref')) {
                const owner = parent.parent
                if (ts.isCallExpression(owner) && owner.expression === parent) return true
                return ts.isPropertyAccessExpression(owner) && owner.expression === parent && owner.name.text === 'hsl' && ts.isCallExpression(owner.parent) && owner.parent.expression === owner
            }
            return ts.isPropertyAccessExpression(parent) && parent.expression === node && parent.name.text === 'hsl' && ts.isCallExpression(parent.parent) && parent.parent.expression === parent
        }

        const isColorBindingUse = (node: ts.Identifier, binding: ts.BindingElement): boolean => node === binding.name || isColorFactoryUse(node)

        const isTypePosition = (node: ts.Node): boolean => {
            let parent = node.parent
            while (parent) {
                if (ts.isTypeNode(parent) || ts.isImportSpecifier(parent) || ts.isImportClause(parent)) return true
                parent = parent.parent
            }
            return false
        }

        const validateColorBinding = (binding: ts.BindingElement): void => {
            const bindingSymbol = resolveSymbol(binding.name)
            const check = (node: ts.Node): void => {
                if (ts.isIdentifier(node) && !isTypePosition(node) && resolveSymbol(node) === bindingSymbol && !isColorBindingUse(node, binding)) throw new Error(`${filename}：Color 只能作为 SFA 编译期构造调用使用`)
                ts.forEachChild(node, check)
            }
            check(source)
        }

        const validateColorImport = (binding: ts.Identifier): void => {
            const bindingSymbol = resolveSymbol(binding)
            const check = (node: ts.Node): void => {
                if (ts.isIdentifier(node) && !isTypePosition(node) && node !== binding && resolveSymbol(node) === bindingSymbol && !isColorFactoryUse(node)) throw new Error(`${filename}：Color 只能作为 SFA 编译期构造调用使用`)
                ts.forEachChild(node, check)
            }
            check(source)
        }

        const validateNamespaceColor = (namespace: ts.Identifier): void => {
            const namespaceSymbol = resolveSymbol(namespace)
            const check = (node: ts.Node): void => {
                if (ts.isPropertyAccessExpression(node) && !isTypePosition(node) && ts.isIdentifier(node.expression) && resolveSymbol(node.expression) === namespaceSymbol && node.name.text === 'Color' && !isColorFactoryUse(node)) throw new Error(`${filename}：Color 只能作为 SFA 编译期构造调用使用`)
                if (ts.isElementAccessExpression(node) && !isTypePosition(node) && ts.isIdentifier(node.expression) && resolveSymbol(node.expression) === namespaceSymbol && ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === 'Color' && !isColorFactoryUse(node)) throw new Error(`${filename}：Color 只能作为 SFA 编译期构造调用使用`)
                ts.forEachChild(node, check)
            }
            check(source)
        }

        const removeVariableDeclaration = (declaration: ts.VariableDeclaration): void => {
            const list = declaration.parent
            if (!ts.isVariableDeclarationList(list) || !ts.isVariableStatement(list.parent)) throw new Error(`${filename}：Color 解构只能出现在变量声明语句中`)
            const statement = list.parent
            const index = list.declarations.indexOf(declaration)
            const previous = index > 0 ? list.declarations[index - 1] : undefined
            const next = index + 1 < list.declarations.length ? list.declarations[index + 1] : undefined
            if (list.declarations.length === 1) output.remove(statement.getStart(source), statement.end)
            else if (next) output.remove(declaration.getStart(source), next.getStart(source))
            else output.remove(previous!.end, declaration.end)
        }

        const removeColorBindings = (): void => {
            const visitBindings = (node: ts.Node): void => {
                if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name)) {
                    const colors = node.name.elements.filter(isColorBinding)
                    if (colors.length) {
                        colors.forEach(validateColorBinding)
                        if (colors.length === node.name.elements.length) removeVariableDeclaration(node)
                        else {
                            let start = 0
                            while (start < node.name.elements.length) {
                                while (start < node.name.elements.length && !colors.includes(node.name.elements[start])) start++
                                if (start >= node.name.elements.length) break
                                let end = start
                                while (end + 1 < node.name.elements.length && colors.includes(node.name.elements[end + 1])) end++
                                const previous = start > 0 ? node.name.elements[start - 1] : undefined
                                const next = end + 1 < node.name.elements.length ? node.name.elements[end + 1] : undefined
                                if (previous && next) output.remove(node.name.elements[start].getStart(source), next.getStart(source))
                                else if (next) output.remove(node.name.elements[start].getStart(source), next.getStart(source))
                                else if (previous) output.remove(previous.end, node.name.elements[end].end)
                                else removeVariableDeclaration(node)
                                start = end + 1
                            }
                        }
                    }
                }
                ts.forEachChild(node, visitBindings)
            }
            visitBindings(source)
        }

        removeColorBindings()

        const namespaceOnlyUsedForColor = (name: string): boolean => {
            let valid = true
            const check = (node: ts.Node): void => {
                if (!valid) return
                if (ts.isIdentifier(node) && node.text === name && !ts.isImportClause(node.parent) && !ts.isNamespaceImport(node.parent)) {
                    const parent = node.parent
                    const propertyUse = ts.isPropertyAccessExpression(parent) && parent.expression === node && parent.name.text === 'Color'
                    const elementUse = ts.isElementAccessExpression(parent) && parent.expression === node && ts.isStringLiteralLike(parent.argumentExpression) && parent.argumentExpression.text === 'Color'
                    const colorDestructure = ts.isVariableDeclaration(parent) && parent.initializer === node && ts.isObjectBindingPattern(parent.name) && parent.name.elements.length > 0 && parent.name.elements.every(isColorBinding)
                    if (!propertyUse && !elementUse && !colorDestructure) valid = false
                }
                ts.forEachChild(node, check)
            }
            check(source)
            return valid
        }

        for (const statement of source.statements) {
            if (!ts.isImportDeclaration(statement)) continue
            const importClause = statement.importClause
            if (!importClause) continue
            const moduleName = ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : undefined
            const bindings = importClause.namedBindings
            if (!bindings) continue

            if (ts.isNamespaceImport(bindings) && (moduleName === '@arrange/framework/ui' || moduleName === '@arrange/framework')) {
                validateNamespaceColor(bindings.name)
            }

            if (ts.isNamespaceImport(bindings) && namespaceOnlyUsedForColor(bindings.name.text) && (moduleName === '@arrange/framework/ui' || moduleName === '@arrange/framework')) {
                if (importClause.name) output.overwrite(statement.getStart(source), statement.end, `import ${importClause.name.getText(source)} from ${statement.moduleSpecifier.getText(source)}`)
                else output.remove(statement.getStart(source), statement.end)
                continue
            }

            if (!ts.isNamedImports(bindings)) continue

            const colorSpecifiers = bindings.elements.filter(specifier => {
                const imported = specifier.propertyName && (ts.isIdentifier(specifier.propertyName) || ts.isStringLiteral(specifier.propertyName)) ? specifier.propertyName.text : ts.isIdentifier(specifier.name) || ts.isStringLiteral(specifier.name) ? specifier.name.text : undefined
                return imported === 'Color' && (moduleName === '@arrange/framework/ui' || moduleName === '@arrange/framework' || isColorSymbol(specifier.name))
            })
            if (!colorSpecifiers.length) continue
            colorSpecifiers.forEach(specifier => validateColorImport(specifier.name))
            if (colorSpecifiers.length === bindings.elements.length) {
                if (importClause.name) output.overwrite(statement.getStart(source), statement.end, `import ${importClause.name.getText(source)} from ${statement.moduleSpecifier.getText(source)}`)
                else output.remove(statement.getStart(source), statement.end)
                continue
            }

            for (const specifier of colorSpecifiers) {
                const index = bindings.elements.indexOf(specifier)
                const previous = index > 0 ? bindings.elements[index - 1] : undefined
                const next = index + 1 < bindings.elements.length ? bindings.elements[index + 1] : undefined
                if (next) output.remove(specifier.getStart(source), next.getStart(source))
                else if (previous) output.remove(previous.end, specifier.end)
                else output.remove(specifier.getStart(source), specifier.end)
            }
        }
    }

    validateValueUnits(program, source, expressionKind, valueKind, filename, previousMap)
    visit(source)
    removeColorImports()
    const generated = output.toString().replaceAll(SFA_UNIT_SEPARATOR, '')
    const map = output.generateMap({ source: filename, includeContent: true, hires: true }) as unknown as RawSourceMap
    if (previousMap) {
        const generator = SourceMapGenerator.fromSourceMap(new SourceMapConsumer(map))
        generator.applySourceMap(new SourceMapConsumer(previousMap), filename)
        return { content: generated, map: generator.toJSON(), deps }
    }
    return { content: generated, map, deps }
}

function uniqueName(source: string, prefix: string): string {
    let name = prefix
    while (source.includes(name)) name += '_'
    return name
}
