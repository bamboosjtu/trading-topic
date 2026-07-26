import type { BacktestExperimentSummary } from "../../api/client";
import { ExperimentHistoryTable } from "./ExperimentHistoryTable";

interface BacktestHistoryTabProps {
  experiments: BacktestExperimentSummary[];
  loading: boolean;
  deletingId?: string;
  onView: (experiment: BacktestExperimentSummary) => void;
  onCopy: (experiment: BacktestExperimentSummary) => void;
  onDelete: (experiment: BacktestExperimentSummary) => void;
}

export function BacktestHistoryTab(props: BacktestHistoryTabProps) {
  return <ExperimentHistoryTable {...props} />;
}
