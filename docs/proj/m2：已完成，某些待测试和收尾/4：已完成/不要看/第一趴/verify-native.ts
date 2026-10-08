import { dirname, join } from 'node:path'
import { cmakeExe, runInVsDev } from '../../../../../../scripts/common.ts'

const cmake = cmakeExe()
const ctest = join(dirname(cmake), 'ctest.exe')
const targets = 'arrange_core_smoke arrange_m24_contract arrange_modifier_runtime arrange_slot_runtime arrange_frame_submission arrange_retained_paint arrange_juce_runtime_smoke arrange_vue_runtime arrange_quickjs_modifier arrange_quickjs_app_smoke'
for (const configuration of ['debug', 'release']) {
    const directory = 'build/m23-final-' + configuration
    await runInVsDev(`"${cmake}" --build ${directory} --target ${targets} --parallel 6`)
    await runInVsDev(`"${ctest}" --test-dir ${directory} --output-on-failure --timeout 45`)
}
