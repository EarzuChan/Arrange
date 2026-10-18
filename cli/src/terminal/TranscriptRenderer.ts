import type { SessionDocument } from './SessionDocument.ts'
import { layoutDocument } from './DocumentRenderer.ts'
import { paint } from './LayoutModel.ts'
import { visibleWidth } from '../util/TerminalText.ts'

export class TranscriptRenderer {
    render(document: SessionDocument): string {
        const rows = layoutDocument(document, 1, {}, 0, undefined, true)
        const lines = rows.map(row => paint(row.spans, row.spans.reduce((width, part) => width + visibleWidth(part.text), 0), false))
        return '\n' + lines.join('\n') + '\n\n'
    }
}
