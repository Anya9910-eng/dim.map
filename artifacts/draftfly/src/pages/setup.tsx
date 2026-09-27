import { useListSetupItems, useUpdateSetupItem, getListSetupItemsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, Server, Key, Settings, Zap } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Label } from "recharts";

export default function SetupPage() {
  const { data: items, isLoading } = useListSetupItems();
  const updateItem = useUpdateSetupItem();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleToggle = (id: number, current: boolean) => {
    updateItem.mutate({ id, data: { isCompleted: !current } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSetupItemsQueryKey() });
      },
      onError: () => {
        toast({ title: "Failed to update status", variant: "destructive" });
      }
    });
  };

  if (isLoading) return <div className="p-8 text-center text-muted-foreground animate-pulse">Loading checklist...</div>;

  const categories = [
    { id: "infrastructure", title: "Infrastructure", icon: Server },
    { id: "integrations", title: "Integrations & API Keys", icon: Key },
    { id: "configuration", title: "Configuration", icon: Settings },
    { id: "testing", title: "Testing & Go-Live", icon: Zap },
  ];

  const total = items?.length || 0;
  const completed = items?.filter(i => i.isCompleted).length || 0;
  const progress = total === 0 ? 0 : Math.round((completed / total) * 100);

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Operator Setup</h1>
        <p className="text-sm text-muted-foreground mt-1">Complete these steps to fully operationalize your DraftFly instance.</p>
      </div>

      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="font-medium">Overall Progress</div>
            <div className="text-xl font-bold tracking-tight">{progress}%</div>
          </div>
          <Progress value={progress} className="h-3" />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {categories.map(cat => {
          const catItems = items?.filter(i => i.category === cat.id) || [];
          if (catItems.length === 0) return null;
          
          const catCompleted = catItems.filter(i => i.isCompleted).length;
          const catProgress = Math.round((catCompleted / catItems.length) * 100);
          
          return (
            <Card key={cat.id} className="overflow-hidden">
              <CardHeader className="bg-muted/30 border-b pb-4">
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-2">
                    <cat.icon className="h-5 w-5 text-muted-foreground" />
                    <CardTitle className="text-base">{cat.title}</CardTitle>
                  </div>
                  <div className="text-xs font-medium bg-background px-2 py-1 rounded-full border">
                    {catCompleted}/{catItems.length}
                  </div>
                </div>
                <Progress value={catProgress} className="h-1 mt-3" />
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {catItems.map(item => (
                    <div 
                      key={item.id} 
                      className={`flex items-start gap-3 p-4 transition-colors ${item.isCompleted ? 'bg-muted/10 opacity-70' : 'hover:bg-muted/30'}`}
                    >
                      <Checkbox 
                        id={`item-${item.id}`} 
                        checked={item.isCompleted} 
                        onCheckedChange={() => handleToggle(item.id, item.isCompleted)}
                        className="mt-1"
                      />
                      <div className="flex-1 space-y-1">
                        <Label 
                          className={`text-sm font-medium leading-none cursor-pointer ${item.isCompleted ? 'line-through text-muted-foreground' : ''}`}
                        >
                          {item.title}
                        </Label>
                        <p className="text-xs text-muted-foreground leading-snug">
                          {item.description}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
