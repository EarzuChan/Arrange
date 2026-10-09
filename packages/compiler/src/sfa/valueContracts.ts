import ts from 'typescript'
import { unitFieldContracts, type UnitFields, type ValueUnit } from '@arrange/shared'

export type ValueRule = ValueUnit | UnitFields
export interface SfaValueContract {
    value?: ValueUnit
    fields?: UnitFields
    arguments?: readonly (ValueRule | undefined)[]
    result?: ValueUnit
    modifier?: boolean
    modifierCall?: boolean
    call?: boolean
    checkProps?: boolean
    unref?: boolean
    parameterInputs?: boolean
    parameterObject?: boolean
    resolve?: boolean
}

// 契约绑定正式模块的声明身份，重导出和别名共享身份，局部同名声明保持原始含义
export function createSfaValueContracts(checker: ts.TypeChecker, source: ts.SourceFile) {
    const symbols = new Map<ts.Symbol, SfaValueContract>()
    const declarations = new Map<ts.Node, SfaValueContract>()
    const actual = (symbol: ts.Symbol | undefined): ts.Symbol | undefined => symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
    const register = (symbol: ts.Symbol | undefined, contract: SfaValueContract): void => {
        symbol = actual(symbol)
        if (!symbol) return
        symbols.set(symbol, { ...symbols.get(symbol), ...contract })
        for (const declaration of symbol.declarations ?? []) declarations.set(declaration, symbols.get(symbol)!)
        for (const signature of checker.getTypeOfSymbolAtLocation(symbol, source).getCallSignatures()) if (signature.declaration && symbol.declarations?.some(declaration => declaration === signature.declaration!.parent)) declarations.set(signature.declaration, symbols.get(symbol)!)
    }
    const modules = new Map<string, ts.Symbol>()
    for (const statement of source.statements) if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        const symbol = checker.getSymbolAtLocation(statement.moduleSpecifier)
        if (symbol) modules.set(statement.moduleSpecifier.text, symbol)
    }
    const exported = (module: string, name: string): ts.Symbol | undefined => {
        const symbol = modules.get(module)
        return symbol && actual(checker.getExportsOfModule(symbol).find(item => item.name === name))
    }
    const property = (symbol: ts.Symbol | undefined, name: string): ts.Symbol | undefined => symbol && checker.getTypeOfSymbolAtLocation(symbol, source).getProperty(name)
    const resultType = (symbol: ts.Symbol | undefined): ts.Type | undefined => {
        const signature = symbol && checker.getTypeOfSymbolAtLocation(symbol, source).getCallSignatures()[0]
        return signature && checker.getReturnTypeOfSignature(signature)
    }
    const animation = '@arrange/framework/animation'
    const ui = '@arrange/framework/ui'
    const root = '@arrange/framework'
    const internal = '@arrange/framework/internal'
    for (const [name, value] of [['Dp', 'dp'], ['Sp', 'sp'], ['Px', 'px']] as const) register(exported(ui, name), { value })
    const color = exported(ui, 'Color')
    register(color, { value: 'color' })
    register(property(color, 'hsl'), { value: 'color' })
    const fields = {
        Shape: 'shape', Brush: 'brush', PaddingValue: 'padding', Padding: 'padding', SizeRange: 'sizeRange', BorderOptions: 'border', PaintOptions: 'paint', TextOptions: 'text', TextFieldOptions: 'textField', GraphicsLayerOptions: 'graphics', TextStyleProp: 'style', ArrangementProp: 'arrangement', RowPolicyOptions: 'row', ColumnPolicyOptions: 'column', FlowRowPolicyOptions: 'flow', FlowColumnPolicyOptions: 'flow', PainterSize: 'pxSize',
    }
    for (const [name, field] of Object.entries(fields)) register(exported(ui, name), { fields: unitFieldContracts[field] })
    for (const [name, field] of [['DrawSize', 'pxSize'], ['DrawRect', 'drawRect'], ['DrawPaint', 'drawPaint'], ['DrawTransform', 'graphics']] as const) register(exported(ui, name), { fields: unitFieldContracts[field] })
    const drawScope = exported(ui, 'DrawScope')
    const drawType = drawScope && checker.getDeclaredTypeOfSymbol(drawScope)
    const drawRect = { ...unitFieldContracts.drawRect, ...unitFieldContracts.drawPaint }
    for (const method of ['drawRect', 'drawOval']) register(drawType?.getProperty(method), { arguments: [drawRect] })
    register(drawType?.getProperty('drawRoundRect'), { arguments: [unitFieldContracts.drawRoundRect] })
    register(drawType?.getProperty('drawCircle'), { arguments: [unitFieldContracts.drawCircle] })
    register(drawType?.getProperty('drawLine'), { arguments: [unitFieldContracts.drawLine] })
    for (const method of ['clipRect', 'clipOval']) register(drawType?.getProperty(method), { arguments: [unitFieldContracts.drawRect] })
    register(drawType?.getProperty('clipRoundRect'), { arguments: [{ ...unitFieldContracts.drawRect, radius: 'px' }] })
    register(drawType?.getProperty('withTransform'), { arguments: [unitFieldContracts.graphics] })
    for (const [name, field] of [['Offset', 'dpOffset'], ['Size', 'dpSize'], ['Rect', 'dpRect']] as const) register(exported(animation, name), { fields: unitFieldContracts[field] })
    register(exported(animation, 'VisibilityTransform'), { fields: unitFieldContracts.graphics })
    const scroll = exported(root, 'ScrollState')
    register(scroll, { fields: unitFieldContracts.scroll })
    const scrollType = scroll && checker.getDeclaredTypeOfSymbol(scroll)
    register(scrollType?.getProperty('scrollTo'), { arguments: ['px'] })
    register(exported(root, 'createScrollState'), { arguments: [unitFieldContracts.scrollOptions] })
    register(property(exported(ui, 'GridCells'), 'Adaptive'), { arguments: ['length'] })
    const lazyState = exported(root, 'LazyState')
    register(lazyState, { fields: { ...unitFieldContracts.scroll, firstVisibleItemScrollOffset: 'px' } })
    const lazyType = lazyState && checker.getDeclaredTypeOfSymbol(lazyState)
    register(lazyType?.getProperty('scrollToItem'), { arguments: [undefined, 'px'] })
    register(lazyType?.getProperty('animateScrollToItem'), { arguments: [undefined, 'px'] })
    for (const method of ['createLazyState', 'createLazyListState', 'createLazyGridState']) register(exported(root, method), { arguments: [{ firstVisibleItemScrollOffset: 'px' }] })
    register(exported(root, 'unref'), { unref: true })
    register(exported(ui, 'Modifier'), { modifier: true })
    register(exported(internal, 'arrangeModifier'), { modifierCall: true })
    register(exported(internal, 'callArrangable'), { call: true })
    register(exported(internal, 'parameterInputs'), { parameterInputs: true })
    register(exported(internal, 'parameterObject'), { parameterObject: true })
    register(exported(internal, 'resolveArrangable'), { resolve: true })
    register(exported(ui, 'colorToHex'), { arguments: ['color'] })
    register(exported(ui, 'solidColor'), { arguments: ['color'] })
    register(exported(ui, 'rounded'), { arguments: ['length'] })
    register(exported(ui, 'PaddingValues'), { arguments: [unitFieldContracts.padding] })
    const spacedBy = property(exported(ui, 'Arrangement'), 'spacedBy')
    register(spacedBy, { arguments: ['length'] })
    const arrangement = resultType(spacedBy)
    // 返回值的映射别名可能是通用 Readonly，字段契约只登记在正式字段的原始声明节点
    for (const field of arrangement?.getProperties() ?? []) for (const declaration of field.declarations ?? []) declarations.set(declaration.parent, { fields: unitFieldContracts.arrangement })
    const animatedValues = { dp: 'dp', color: 'color', offset: unitFieldContracts.dpOffset, size: unitFieldContracts.dpSize, rect: unitFieldContracts.dpRect } as const
    for (const [name, rule] of [['animatedDpAsRef', 'dp'], ['animatedColorAsRef', 'color'], ['animatedOffsetAsRef', 'offset'], ['animatedSizeAsRef', 'size'], ['animatedRectAsRef', 'rect']] as const) {
        register(exported(animation, name), { arguments: [animatedValues[rule]], result: rule === 'dp' || rule === 'color' ? rule : undefined })
    }
    const transition = resultType(exported(animation, 'createTransition'))
    for (const [method, rule] of [['animatedDp', 'dp'], ['animatedColor', 'color'], ['animatedOffset', 'offset'], ['animatedSize', 'size'], ['animatedRect', 'rect']] as const) {
        register(transition?.getProperty(method), { arguments: [undefined, animatedValues[rule]], result: rule === 'dp' || rule === 'color' ? rule : undefined })
    }
    const infinite = resultType(exported(animation, 'createInfiniteTransition'))
    for (const [method, rule] of [['animatedDp', 'dp'], ['animatedColor', 'color']] as const) {
        register(infinite?.getProperty(method), { arguments: [undefined, rule, rule], result: rule })
    }
    for (const statement of source.statements) if (ts.isFunctionDeclaration(statement) && statement.name?.text === '__arrangeCheck' && statement.pos >= source.text.indexOf('\nimport * as __ArrangeUnitsFoundation')) register(checker.getSymbolAtLocation(statement.name), { checkProps: true })
    const forSymbol = (symbol: ts.Symbol | undefined): SfaValueContract | undefined => {
        symbol = actual(symbol)
        return symbol && symbols.get(symbol)
    }
    const forDeclaration = (node: ts.Node | undefined): SfaValueContract | undefined => node && declarations.get(node)
    const forExpression = (node: ts.Node, seen = new Set<ts.Node>()): SfaValueContract | undefined => {
        if (seen.has(node)) return
        seen.add(node)
        if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node)) return forExpression(node.expression, seen)
        const symbol = actual(checker.getSymbolAtLocation(node))
        const contract = forSymbol(symbol)
        if (contract) return contract
        const declaration = symbol?.valueDeclaration
        const initializer = declaration && (ts.isVariableDeclaration(declaration) || ts.isPropertyAssignment(declaration)) && declaration.initializer
        if (initializer && (ts.isIdentifier(initializer) || ts.isPropertyAccessExpression(initializer) || ts.isElementAccessExpression(initializer) || ts.isParenthesizedExpression(initializer) || ts.isAsExpression(initializer) || ts.isNonNullExpression(initializer) || ts.isSatisfiesExpression(initializer))) return forExpression(initializer, seen)
    }
    const forCall = (node: ts.CallExpression): SfaValueContract | undefined => forExpression(node.expression) ?? forDeclaration(checker.getResolvedSignature(node)?.declaration)
    const fieldsOf = (type: ts.Type): UnitFields | undefined => {
        const fields = forSymbol(type.aliasSymbol)?.fields ?? forSymbol(type.symbol)?.fields
        if (fields) return fields
        for (const property of type.getProperties()) for (const declaration of property.declarations ?? []) {
            let parent: ts.Node | undefined = declaration.parent
            while (parent && !ts.isSourceFile(parent)) {
                const fields = forDeclaration(parent)?.fields
                if (fields) return fields
                parent = parent.parent
            }
        }
        return type.isUnion() ? type.types.map(fieldsOf).find(Boolean) : undefined
    }
    return { forSymbol, forDeclaration, forExpression, forCall, fieldsOf }
}

export type SfaValueContracts = ReturnType<typeof createSfaValueContracts>
