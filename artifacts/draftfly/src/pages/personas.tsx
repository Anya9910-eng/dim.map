import { useListPersonas, useListClients, useCreatePersona, getListPersonasQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "wouter";
import { UserCircle, Plus, ChevronRight } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useState, useEffect } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Textarea } from "@/components/ui/textarea";

export default function PersonasPage() {
  const { data: personas, isLoading } = useListPersonas();
  const { data: clients } = useListClients();
  const createPersona = useCreatePersona();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { isOperator, clientId: ownClientId } = useAuth();
  const [open, setOpen] = useState(false);

  // Preselected for a client user, who has exactly one client and whose
  // choice the API would refuse anyway.
  const [formData, setFormData] = useState({
    clientId: ownClientId != null ? String(ownClientId) : "",
    name: "",
    productDescription: "",
    targetAudience: "",
    toneOfVoice: "",
    cta: "",
  });

  // useAuth resolves asynchronously, so fill the preselected client in once
  // the session is known — otherwise a client user submits no clientId.
  useEffect(() => {
    if (ownClientId != null) {
      setFormData((prev) => (prev.clientId ? prev : { ...prev, clientId: String(ownClientId) }));
    }
  }, [ownClientId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createPersona.mutate({ 
      data: { 
        ...formData, 
        clientId: parseInt(formData.clientId, 10) 
      } 
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPersonasQueryKey() });
        setOpen(false);
        setFormData({ clientId: "", name: "", productDescription: "", targetAudience: "", toneOfVoice: "", cta: "" });
        toast({ title: "Persona created" });
      },
      onError: () => {
        toast({ title: "Error creating persona", variant: "destructive" });
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Personas</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage AI personas for your campaigns.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-persona"><Plus className="h-4 w-4 mr-2" /> New Persona</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Create Persona</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              {isOperator && (
                <div className="space-y-2">
                  <Label htmlFor="clientId">Client</Label>
                  <Select value={formData.clientId} onValueChange={(val) => setFormData({ ...formData, clientId: val })}>
                    <SelectTrigger data-testid="select-client"><SelectValue placeholder="Select client" /></SelectTrigger>
                    <SelectContent>
                      {clients?.map(c => <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="name">Persona Name</Label>
                <Input id="name" data-testid="input-persona-name" required value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="e.g. Sales Engineer" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="productDescription">Product Description</Label>
                <Textarea id="productDescription" data-testid="input-product-description" required value={formData.productDescription} onChange={e => setFormData({ ...formData, productDescription: e.target.value })} placeholder="Briefly describe the product..." />
              </div>
              <div className="space-y-2">
                <Label htmlFor="targetAudience">Target Audience</Label>
                <Input id="targetAudience" data-testid="input-target-audience" required value={formData.targetAudience} onChange={e => setFormData({ ...formData, targetAudience: e.target.value })} placeholder="e.g. CTOs, VP of Engineering" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="toneOfVoice">Tone of Voice</Label>
                <Input id="toneOfVoice" data-testid="input-tone-of-voice" required value={formData.toneOfVoice} onChange={e => setFormData({ ...formData, toneOfVoice: e.target.value })} placeholder="e.g. Professional, authoritative, concise" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cta">Call to Action (CTA)</Label>
                <Input id="cta" data-testid="input-cta" required value={formData.cta} onChange={e => setFormData({ ...formData, cta: e.target.value })} placeholder="e.g. Can we schedule a brief 10-minute call?" />
              </div>
              <Button type="submit" className="w-full" disabled={createPersona.isPending || !formData.clientId} data-testid="button-submit-persona">
                {createPersona.isPending ? "Creating..." : "Create Persona"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          [1, 2, 3].map(i => <div key={i} className="h-40 bg-muted animate-pulse rounded-xl" />)
        ) : personas?.map(persona => (
          <Card key={persona.id} className="hover:border-primary/50 transition-colors flex flex-col" data-testid={`card-persona-${persona.id}`}>
            <CardHeader className="pb-2">
              <div className="flex justify-between items-start">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <UserCircle className="h-5 w-5 text-primary" />
                  <Link href={`/personas/${persona.id}`} className="hover:underline">{persona.name}</Link>
                </CardTitle>
              </div>
              {/* Every persona on this page belongs to the one client, so for a
                  client user this line repeats their own name on each card. */}
              {isOperator && (
                <div className="text-sm font-mono text-muted-foreground mt-1">
                  Client: {clients?.find(c => c.id === persona.clientId)?.name || "Unknown"}
                </div>
              )}
            </CardHeader>
            <CardContent className="flex-1 flex flex-col justify-between">
              <div className="space-y-3 mt-2 text-sm text-muted-foreground">
                <div>
                  <span className="font-semibold text-foreground">Tone:</span> <span className="truncate block">{persona.toneOfVoice}</span>
                </div>
                <div>
                  <span className="font-semibold text-foreground">CTA:</span> <span className="truncate block">{persona.cta}</span>
                </div>
              </div>
              <div className="flex justify-end mt-4 pt-4 border-t border-border/50">
                <Button variant="ghost" size="sm" asChild className="group text-muted-foreground hover:text-primary">
                  <Link href={`/personas/${persona.id}`} data-testid={`link-edit-persona-${persona.id}`}>
                    Edit Persona <ChevronRight className="h-4 w-4 ml-1 group-hover:translate-x-1 transition-transform" />
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
