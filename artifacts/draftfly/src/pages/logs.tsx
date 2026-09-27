import { useListLogs, useListClients } from "@workspace/api-client-react";
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { LogLevelBadge } from "@/components/status-badges";

export default function LogsPage() {
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [clientFilter, setClientFilter] = useState<string>("all");
  
  const queryParams: any = { limit: 100 };
  if (levelFilter !== "all") queryParams.level = levelFilter;
  if (clientFilter !== "all") queryParams.clientId = parseInt(clientFilter, 10);

  const { data: logs, isLoading } = useListLogs(queryParams);
  const { data: clients } = useListClients();

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">System Logs</h1>
          <p className="text-sm text-muted-foreground mt-1">Detailed activity across all integrations.</p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={clientFilter} onValueChange={setClientFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All Clients" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Clients</SelectItem>
              {clients?.map(c => <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={levelFilter} onValueChange={setLevelFilter}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Level" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Levels</SelectItem>
              <SelectItem value="info">Info</SelectItem>
              <SelectItem value="warning">Warning</SelectItem>
              <SelectItem value="error">Error</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted text-muted-foreground text-xs uppercase font-medium">
              <tr>
                <th className="px-4 py-3 w-40">Time</th>
                <th className="px-4 py-3 w-24">Level</th>
                <th className="px-4 py-3 w-32">Source</th>
                <th className="px-4 py-3">Message</th>
              </tr>
            </thead>
            <tbody className="divide-y font-mono text-xs">
              {isLoading ? (
                <tr><td colSpan={4} className="p-8 text-center animate-pulse text-muted-foreground font-sans">Loading logs...</td></tr>
              ) : logs?.length === 0 ? (
                <tr><td colSpan={4} className="p-8 text-center text-muted-foreground font-sans">No logs found.</td></tr>
              ) : (
                logs?.map(log => (
                  <tr key={log.id} className={`hover:bg-muted/30 transition-colors ${log.level === 'error' ? 'bg-red-50/30 dark:bg-red-900/10' : ''}`}>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {new Date(log.createdAt).toISOString().replace('T', ' ').substring(0, 19)}
                    </td>
                    <td className="px-4 py-3 font-sans">
                      <LogLevelBadge level={log.level as any} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground font-semibold">
                      {log.source}
                    </td>
                    <td className="px-4 py-3 text-foreground break-all">
                      {log.message}
                      {log.clientId && <span className="ml-2 px-1.5 py-0.5 bg-muted rounded text-[10px] opacity-70">Client: {log.clientId}</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
