// 终端模式由驱动持有，绘制器只生成屏幕内容
export const protocol = Object.freeze({
    enter: '\x1b[?1049h\x1b[0m\x1b[H\x1b[2J\x1b[?25l\x1b[?1000h\x1b[?1006h\x1b[?2004h',
    stopReports: '\x1b[?2004l\x1b[?1000l\x1b[?1006l',
    leave: '\x1b[0m\x1b[?25h\x1b[?1049l',
})

// 拍扁文本保留逻辑行，输出时统一转换为明确的 CRLF
export const terminalLines = text => String(text).replace(/\r?\n/g, '\r\n')
