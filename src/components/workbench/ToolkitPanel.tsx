import type { ArtifactModel } from "@/data/samples";
import type { ArtifactEditing } from "@/lib/artifact-editing";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RiskLogView } from "./RiskLogView";
import { ChangeRequestView } from "./ChangeRequestView";
import { CommunicationPlanView } from "./CommunicationPlanView";
import { TestCaseView } from "./TestCaseView";
import { StakeholderAnalysisView } from "./StakeholderAnalysisView";
import { BusinessCaseView } from "./BusinessCaseView";
import { RequirementsManagementPlanView } from "./RequirementsManagementPlanView";

// Home for the 7-artifact BA suite. A single "Toolkit" tab with its own
// sub-navigation, rather than 7 more top-level tabs crowding the artifact
// tab bar next to Process map/Use cases/RACI/Items/BRD/Backlog. Built on
// ui/tabs.tsx, confirmed unused anywhere else in the app before this.
export function ToolkitPanel({ model, editing }: { model: ArtifactModel; editing: ArtifactEditing }) {
  return (
    <Tabs defaultValue="risks" className="w-full">
      <TabsList className="flex-wrap h-auto">
        <TabsTrigger value="risks">Risk Log</TabsTrigger>
        <TabsTrigger value="changes">Change Requests</TabsTrigger>
        <TabsTrigger value="comms">Communication Plan</TabsTrigger>
        {model.kind === "process" && <TabsTrigger value="tests">Test Cases</TabsTrigger>}
        <TabsTrigger value="stakeholders">Stakeholder Analysis</TabsTrigger>
        <TabsTrigger value="businessCase">Business Case</TabsTrigger>
        <TabsTrigger value="rmp">Requirements Mgmt Plan</TabsTrigger>
      </TabsList>

      <TabsContent value="risks">
        <RiskLogView model={model} onAddRisk={editing.onAddRisk} onUpdateItem={editing.onUpdateItem} onDeleteAny={editing.onDeleteAny} />
      </TabsContent>
      <TabsContent value="changes">
        <ChangeRequestView model={model} onAddChangeRequest={editing.onAddChangeRequest} onUpdateItem={editing.onUpdateItem} onDeleteAny={editing.onDeleteAny} />
      </TabsContent>
      <TabsContent value="comms">
        <CommunicationPlanView model={model} onAddCommunicationPlanItem={editing.onAddCommunicationPlanItem} onUpdateItem={editing.onUpdateItem} onDeleteAny={editing.onDeleteAny} />
      </TabsContent>
      {model.kind === "process" && (
        <TabsContent value="tests">
          <TestCaseView model={model} onAddTestCase={editing.onAddTestCase} onUpdateItem={editing.onUpdateItem} onDeleteAny={editing.onDeleteAny} />
        </TabsContent>
      )}
      <TabsContent value="stakeholders">
        <StakeholderAnalysisView
          model={model}
          onAddStakeholder={model.kind === "bmc" ? editing.onAddStakeholder : undefined}
          onUpdateItem={editing.onUpdateItem}
        />
      </TabsContent>
      <TabsContent value="businessCase">
        <BusinessCaseView
          model={model}
          onUpdateBusinessCase={editing.onUpdateBusinessCase}
          onAddBusinessCaseOption={editing.onAddBusinessCaseOption}
          onUpdateItem={editing.onUpdateItem}
          onDeleteAny={editing.onDeleteAny}
        />
      </TabsContent>
      <TabsContent value="rmp">
        <RequirementsManagementPlanView model={model} onUpdateRMP={editing.onUpdateRMP} />
      </TabsContent>
    </Tabs>
  );
}
