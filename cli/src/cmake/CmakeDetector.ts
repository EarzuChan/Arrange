import type { ProjectContext } from "../project/ProjectContext.ts"

export interface CmakeDetectedFeature {
    readonly key: string
    readonly description: string
    readonly confidence: "low" | "medium" | "high"
}

export class CmakeDetector {
    async detect(context: ProjectContext): Promise<CmakeDetectedFeature[]> {
        void context
        // TODO：识别 FetchContent、juce_add_plugin、target_link_libraries、managed regions 等特征
        return []
    }
}
