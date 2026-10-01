export type AiExperienceMode = "simple" | "instant" | "medium" | "high";

export type AiCouncilStage =
  | "planner"
  | "web-researcher"
  | "database-scholar"
  | "independent-tutor"
  | "verifier"
  | "critic"
  | "synthesizer";

export type AiCouncilPlan = {
  mode: AiExperienceMode;
  stages: AiCouncilStage[];
  usesLocalOnly: boolean;
  usesWeb: boolean;
  description: string;
};

export function normalizeAiExperienceMode(value: unknown): AiExperienceMode {
  return value === "simple" || value === "medium" || value === "high" ? value : "instant";
}

export function aiCouncilPlan(mode: AiExperienceMode, useWeb = false): AiCouncilPlan {
  if (mode === "simple") {
    return {
      mode,
      stages: [],
      usesLocalOnly: true,
      usesWeb: false,
      description: "Local/browser retrieval dan helper ringan tanpa provider cloud.",
    };
  }

  if (mode === "instant") {
    return {
      mode,
      stages: [],
      usesLocalOnly: false,
      usesWeb: useWeb,
      description: "Satu jawaban langsung dengan retrieval yang relevan dan fallback provider lama.",
    };
  }

  if (mode === "medium") {
    return {
      mode,
      stages: ["planner", "database-scholar", "independent-tutor", "synthesizer"],
      usesLocalOnly: false,
      usesWeb: useWeb,
      description: "Planner ringan, dua sudut pandang, lalu satu synthesizer.",
    };
  }

  return {
    mode,
    stages: [
      "planner",
      ...(useWeb ? ["web-researcher" as const] : []),
      "database-scholar",
      "independent-tutor",
      "verifier",
      "critic",
      "synthesizer",
    ],
    usesLocalOnly: false,
    usesWeb: useWeb,
    description: "Planner → Database/Scholarly/Web → tiga agen → verifier → critic → synthesizer.",
  };
}

export function aiCouncilStageLabel(stage: AiCouncilStage) {
  return {
    planner: "Planner",
    "web-researcher": "Web researcher",
    "database-scholar": "Database & scholarly researcher",
    "independent-tutor": "Independent tutor",
    verifier: "Citation/fact verifier",
    critic: "Critic",
    synthesizer: "Final synthesizer",
  }[stage];
}
