import { expose } from "comlink";

import { analyzeAudio } from "../features/audio/analysis";

export type AudioAnalysisWorker = typeof analyzeAudio;

expose(analyzeAudio);
