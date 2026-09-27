import { useListSetupItems, useUpdateSetupItem, getListSetupItemsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Server, Key, Settings, Zap } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Label } from "@/components/ui/label";

export default function InternalSetupPage() {
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

  if (isLoading) return <div className="p-8 text-center text-muted-foreground animate-pulse" data-testid="loading-state">Loading internal setup...</div>;

  const categories = [
    { id: "infrastructure", title: "Infrastructure", icon: Server },
    { id: "integrations", title: "Integrations", icon: Key },
    { id: "configuration", title: "Configuration", icon: Settings },
    { id: "testing", title: "Testing", icon: Zap },
  ];

  // We are only showing internal_setup items if they exist
  // Using all items for now, but in a real app we'd filter by checklistType
  const setupItems = items || [];

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-title">Internal Setup</h1>
        <p className="text-sm text-muted-foreground mt-1">Operator-only checklist to prepare the system environment.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {categories.map(cat => {
          const catItems = setupItems.filter(i => i.category === cat.id);
          if (catItems.length === 0) return null;
          
          const catCompleted = catItems.filter(i => i.isCompleted).length;
          const catProgress = Math.round((catCompleted / catItems.length) * 100);
          
          return (
            <Card key={cat.id} className="overflow-hidden bg-card" data-testid={`card-category-${cat.id}`}>
              <CardHeader className="bg-muted/20 border-b pb-4">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded bg-primary/10 flex items-center justify-center">
                      <cat.icon className="h-4 w-4 text-primary" />
                    </div>
                    <CardTitle className="text-base font-semibold">{cat.title}</CardTitle>
                  </div>
                  
                  {/* Progress Ring / Circle */}
                  <div className="relative w-10 h-10 flex items-center justify-center">
                    <svg className="w-10 h-10 transform -rotate-90" viewBox="0 0 36 36">
                      <path
                        className="text-muted stroke-current"
                        strokeWidth="3"
                        fill="none"
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      />
                      <path
                        className="text-primary stroke-current transition-all duration-500 ease-in-out"
                        strokeWidth="3"
                        strokeDasharray={`${catProgress}, 100`}
                        fill="none"
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      />
                    </svg>
                    <span className="absolute text-[10px] font-medium">{catCompleted}/{catItems.length}</span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-border/50">
                  {catItems.map(item => (
                    <div 
                      key={item.id} 
                      className={`flex items-start gap-3 p-4 transition-colors ${item.isCompleted ? 'bg-muted/5 opacity-80' : 'hover:bg-muted/10'}`}
                      data-testid={`item-${item.id}`}
                    >
                      <Checkbox 
                        id={`setup-${item.id}`} 
                        checked={item.isCompleted} 
                        onCheckedChange={() => handleToggle(item.id, item.isCompleted)}
                        className="mt-1"
                        data-testid={`checkbox-${item.id}`}
                      />
                      <div className="flex-1 space-y-1">
                        <Label 
                          htmlFor={`setup-${item.id}`} 
                          className={`text-sm font-medium leading-none cursor-pointer ${item.isCompleted ? 'text-muted-foreground' : 'text-foreground'}`}
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
