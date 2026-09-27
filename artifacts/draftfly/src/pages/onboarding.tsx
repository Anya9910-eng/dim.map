import { useListSetupItems, useUpdateSetupItem, getListSetupItemsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export default function OnboardingPage() {
  const { data: allItems, isLoading } = useListSetupItems();
  const updateItem = useUpdateSetupItem();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [currentStep, setCurrentStep] = useState(0);

  // Hardcode the onboarding steps to match the specific requirement, using checklist items if they match
  const onboardingSteps = [
    { title: "Install Slack App", description: "Invite the DraftFly bot to your workspace." },
    { title: "Provide Lemlist API key", description: "Securely share your Lemlist key for connection." },
    { title: "Select approval channel", description: "Choose which Slack channel receives drafts." },
    { title: "Provide campaign IDs", description: "List the Lemlist campaigns to monitor." },
    { title: "Provide persona and reply rules", description: "Define your voice and qualification criteria." },
    { title: "Run test reply", description: "Generate a mock reply to ensure end-to-end connectivity." },
    { title: "Confirm Send / Edit / Discard flow", description: "Test the Slack buttons to verify permissions." }
  ];

  // In a real app, these would map to specific DB items by an ID or type.
  // We'll simulate completion state using an array of booleans for this UI.
  const [completedSteps, setCompletedSteps] = useState<boolean[]>(new Array(onboardingSteps.length).fill(false));

  const toggleStep = (index: number) => {
    const newCompleted = [...completedSteps];
    newCompleted[index] = !newCompleted[index];
    setCompletedSteps(newCompleted);
    
    // Auto-advance if checking a box
    if (newCompleted[index] && currentStep === index && currentStep < onboardingSteps.length - 1) {
      setCurrentStep(index + 1);
    }
  };

  const totalCompleted = completedSteps.filter(Boolean).length;
  const progress = Math.round((totalCompleted / onboardingSteps.length) * 100);

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-title">Client Onboarding</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Step-by-step setup wizard to connect a new client to DraftFly.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="font-medium">Setup Progress</span>
          <span className="text-muted-foreground">{totalCompleted} of {onboardingSteps.length} completed ({progress}%)</span>
        </div>
        <Progress value={progress} className="h-2" data-testid="progress-onboarding" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-1 border-r border-border/50 pr-6 space-y-1">
          {onboardingSteps.map((step, index) => (
            <button
              key={index}
              className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors flex items-center justify-between group ${
                currentStep === index 
                  ? "bg-primary/10 text-primary font-medium" 
                  : "hover:bg-muted text-muted-foreground"
              }`}
              onClick={() => setCurrentStep(index)}
              data-testid={`btn-step-${index}`}
            >
              <div className="flex items-center gap-2 truncate">
                <div className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                  completedSteps[index] 
                    ? "bg-primary border-primary text-primary-foreground" 
                    : currentStep === index ? "border-primary text-primary" : "border-muted-foreground/50"
                }`}>
                  {completedSteps[index] && <CheckCircle2 className="h-3 w-3" />}
                </div>
                <span className="truncate">{index + 1}. {step.title}</span>
              </div>
              <ChevronRight className={`h-4 w-4 opacity-0 transition-opacity ${currentStep === index ? "opacity-100" : "group-hover:opacity-50"}`} />
            </button>
          ))}
        </div>

        <div className="md:col-span-2">
          <Card className="h-full border-primary/20 bg-card">
            <CardContent className="p-8 space-y-6">
              <div className="inline-flex items-center justify-center px-2.5 py-1 rounded bg-muted text-xs font-mono text-muted-foreground mb-2">
                Step {currentStep + 1} of {onboardingSteps.length}
              </div>
              
              <div>
                <h2 className="text-xl font-semibold mb-2" data-testid="text-step-title">{onboardingSteps[currentStep].title}</h2>
                <p className="text-muted-foreground text-sm leading-relaxed" data-testid="text-step-desc">
                  {onboardingSteps[currentStep].description}
                </p>
              </div>

              <div className="p-6 border border-dashed rounded-lg bg-muted/20 flex flex-col items-center justify-center gap-4 text-center min-h-[200px]">
                <div className="text-muted-foreground text-sm">
                  Placeholder for interactive setup component.
                  <br/>(e.g., OAuth flow, API key input, channel selector)
                </div>
                
                <div className="flex items-center space-x-2 mt-4 bg-background p-3 rounded-md border shadow-sm w-full max-w-sm justify-center">
                  <Checkbox 
                    id="mark-complete" 
                    checked={completedSteps[currentStep]}
                    onCheckedChange={() => toggleStep(currentStep)}
                    data-testid="checkbox-complete-step"
                  />
                  <Label htmlFor="mark-complete" className="cursor-pointer">Mark step as completed</Label>
                </div>
              </div>

              <div className="flex justify-between pt-4">
                <Button 
                  variant="outline" 
                  onClick={() => setCurrentStep(Math.max(0, currentStep - 1))}
                  disabled={currentStep === 0}
                  data-testid="btn-prev-step"
                >
                  Previous
                </Button>
                
                <Button 
                  onClick={() => {
                    if (!completedSteps[currentStep]) toggleStep(currentStep);
                    if (currentStep < onboardingSteps.length - 1) setCurrentStep(currentStep + 1);
                  }}
                  disabled={currentStep === onboardingSteps.length - 1 && completedSteps[currentStep]}
                  data-testid="btn-next-step"
                >
                  {currentStep === onboardingSteps.length - 1 ? "Finish" : "Next Step"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
