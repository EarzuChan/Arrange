import type { LocalDefinition, ProjectDefinition, ProjectState } from "./ProjectState.ts"
import type { LocalYamlDto, ProjectYamlDto } from "./ProjectStateSchema.ts"

export function projectStateFromDtos(project: ProjectYamlDto, local: LocalYamlDto | null): ProjectState {
    return {
        project: projectDefinitionFromDto(project),
        local: local === null ? null : localDefinitionFromDto(local),
    }
}

export function projectStateToDtos(state: ProjectState): { project: ProjectYamlDto; local: LocalYamlDto | null } {
    return {
        project: projectDefinitionToDto(state.project),
        local: state.local === null ? null : localDefinitionToDto(state.local),
    }
}

function projectDefinitionFromDto(dto: ProjectYamlDto): ProjectDefinition {
    return dto
}

function projectDefinitionToDto(project: ProjectDefinition): ProjectYamlDto {
    return project
}

function localDefinitionFromDto(dto: LocalYamlDto): LocalDefinition {
    return dto
}

function localDefinitionToDto(local: LocalDefinition): LocalYamlDto {
    return local
}
