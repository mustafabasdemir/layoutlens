import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useReports } from "../../data/report-store";
import { useScanJobs } from "../../data/scan-jobs";
import { Button, Card } from "../../ui/primitives";
import { RecentReports } from "../overview/OverviewPage";
import { RecentScans } from "../scan/RecentScans";

export function HistoryPage() {
  const { history, clearHistory } = useReports();
  const { service } = useScanJobs();
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="page">
      <section aria-labelledby="scans-heading">
        <div className="section-head">
          <h2 id="scans-heading" className="section-title">Studio scans</h2>
          <p className="section-meta">
            {service.status === "available"
              ? `Stored on this machine in ${service.info.dataDirectory} (the oldest are removed beyond ${service.info.limits.maxStoredScans}).`
              : "Scans started from Studio are stored by the local scanning service."}
          </p>
        </div>
        <Card className="list-card">
          <RecentScans />
        </Card>
      </section>

      <section aria-labelledby="folders-heading">
        <div className="section-head">
          <h2 id="folders-heading" className="section-title">Opened report folders</h2>
          {history.length > 0 ? (
            confirming ? (
              <span className="confirm">
                <span className="small">Remove all {history.length} entries?</span>
                <Button size="sm" variant="danger" onClick={() => { clearHistory(); setConfirming(false); }}>Clear</Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
              </span>
            ) : (
              <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={() => setConfirming(true)}>
                Clear history
              </Button>
            )
          ) : null}
        </div>
        <p className="section-meta folders-note">
          CLI report folders opened in Studio on this device. Only summary metadata is stored locally; screenshots stay in their folders.
        </p>
        <Card className="list-card">
          <RecentReports />
        </Card>
      </section>
    </div>
  );
}
