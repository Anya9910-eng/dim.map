import { useGetPersona, useUpdatePersona, getGetPersonaQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Save } from "lucide-react";

export default function PersonaDetail() {
  const { id } = useParams();
  const personaId = parseInt(id || "0", 10);
  
  const { data: persona, isLoading } = useGetPersona(personaId, { query: { enabled: !!personaId, queryKey: getGetPersonaQueryKey(personaId) } });
  const updatePersona = useUpdatePersona();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    name: "",
    productDescription: "",
    targetAudience: "",
    toneOfVoice: "",
    commonObjections: "",
    cta: "",
    qualificationRules: ""
  });

  useEffect(() => {
    if (persona) {
      setFormData({
        name: persona.name || "",
        productDescription: persona.productDescription || "",
        targetAudience: persona.targetAudience || "",
        toneOfVoice: persona.toneOfVoice || "",
        commonObjections: persona.commonObjections || "",
        cta: persona.cta || "",
        qualificationRules: persona.qualificationRules || ""
      });
    }
  }, [persona]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updatePersona.mutate({ id: personaId, data: formData }, {
      onSuccess: (updated) => {
        queryClient.setQueryData(getGetPersonaQueryKey(personaId), updated);
        toast({ title: "Persona updated successfully" });
      },
      onError: () => {
        toast({ title: "Failed to update persona", variant: "destructive" });
      }
    });
  };

  if (isLoading) return <div className="p-8 text-center text-muted-foreground animate-pulse" data-testid="loading-state">Loading persona...</div>;
  if (!persona) return <div className="p-8 text-center text-muted-foreground" data-testid="empty-state">Persona not found.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild data-testid="button-back">
          <Link href="/personas"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-persona-title">{persona.name}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure the AI persona's core identity and rules.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Persona Editor</CardTitle>
          <CardDescription>Adjust the messaging rules for AI generation.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="name">Persona Name</Label>
                <Input id="name" data-testid="input-persona-name" required value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="targetAudience">Target Audience</Label>
                <Input id="targetAudience" data-testid="input-target-audience" required value={formData.targetAudience} onChange={e => setFormData({ ...formData, targetAudience: e.target.value })} />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="productDescription">Product Description</Label>
              <Textarea 
                id="productDescription" 
                data-testid="input-product-description"
                className="min-h-[100px]" 
                required 
                value={formData.productDescription} 
                onChange={e => setFormData({ ...formData, productDescription: e.target.value })} 
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="toneOfVoice">Tone of Voice</Label>
              <Input id="toneOfVoice" data-testid="input-tone-of-voice" required value={formData.toneOfVoice} onChange={e => setFormData({ ...formData, toneOfVoice: e.target.value })} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="commonObjections">Common Objections & Handling</Label>
              <Textarea 
                id="commonObjections" 
                data-testid="input-common-objections"
                className="min-h-[100px]" 
                value={formData.commonObjections} 
                onChange={e => setFormData({ ...formData, commonObjections: e.target.value })} 
                placeholder="List objections and how to counter them..."
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="qualificationRules">Qualification Rules</Label>
              <Textarea 
                id="qualificationRules" 
                data-testid="input-qualification-rules"
                className="min-h-[100px]" 
                value={formData.qualificationRules} 
                onChange={e => setFormData({ ...formData, qualificationRules: e.target.value })} 
                placeholder="When should the AI push for a meeting vs disqualify?"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="cta">Call to Action (CTA)</Label>
              <Input id="cta" data-testid="input-cta" required value={formData.cta} onChange={e => setFormData({ ...formData, cta: e.target.value })} />
            </div>

            <div className="pt-4 flex justify-end border-t border-border">
              <Button type="submit" disabled={updatePersona.isPending} data-testid="button-save-persona">
                <Save className="h-4 w-4 mr-2" />
                {updatePersona.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
