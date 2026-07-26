import { useQuery } from "@tanstack/react-query";
import { api, type BacktestExperiment } from "../../api/client";

export function useActiveExperiment(
  activeExperimentId: string | undefined,
  currentExperiment: BacktestExperiment | null,
) {
  const persisted = useQuery({
    queryKey: ["backtest:experiment", activeExperimentId],
    queryFn: () => api.getBacktestExperiment(activeExperimentId!),
    enabled:
      Boolean(activeExperimentId) &&
      currentExperiment?.experimentId !== activeExperimentId,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const activeExperiment =
    currentExperiment &&
    currentExperiment.experimentId === activeExperimentId
      ? currentExperiment
      : (persisted.data ?? undefined);
  return {
    activeExperiment,
    results: activeExperiment?.results ?? [],
    loading: persisted.isLoading,
    error: persisted.error,
  };
}
