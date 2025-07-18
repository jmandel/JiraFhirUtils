<system_context>
This repository contains the source for building the HL7 FHIR standard. Language should be clear, concise, correct, and appropriate.
</system_context>

<file_map>
source/ - Source of the specification
publish/ - Output of build, cannot be modified
</file_map>

<critical_notes>
* Each FHIR resource type has a folder (e.g., Patient in source/patient).
* Inside resource folders, there is a structuredefinition-[resource name].xml file, that has the FHIR StructureDefinition that defines the resource
* Pages describing resources are constructed from the StructureDefinition, introduction file ([resource name]-introduction.xml), and notes file ([resource name]-notes.xml), if they exist.
* -notes.xml and -introduction.xml files are HTML fragments and should validate as such
* the build takes a *very* long time to run - always ask the user before building

</critical_notes>
