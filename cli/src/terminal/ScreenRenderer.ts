import { paint, type View } from './LayoutModel.ts'

export class ScreenRenderer {
    frame(view: View, ansi = true): string {
        const width = Math.max(0, view.columns - 1)
        if (!ansi) return view.rows.map(row => paint(row.spans, width, false)).join('\n')
        let output = '\x1b[?25l\x1b[0m\x1b[H\x1b[2J'
        view.rows.forEach((row, index) => { output += '\x1b[' + (index + 1) + ';1H' + paint(row.spans, width, true) })
        const y = view.rows.findIndex(row => row.cursorX !== undefined)
        if (y >= 0) output += '\x1b[' + (y + 1) + ';' + view.rows[y]!.cursorX + 'H\x1b[?25h'
        return output
    }
}
