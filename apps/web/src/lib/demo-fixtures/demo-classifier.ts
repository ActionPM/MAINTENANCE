import type { IssueClassifierInput, IssueClassifierOutput } from '@wo-agent/schemas';

/**
 * Classification presets verified against taxonomy.json + taxonomy_constraints.json.
 *
 * Every parent→child pair is valid in the constraint hierarchy:
 *   Location → Sub_Location → Maintenance_Category → Maintenance_Object → Maintenance_Problem
 */

interface Preset {
  classification: Record<string, string>;
  model_confidence: Record<string, number>;
}

const PLUMBING_PRESET: Preset = {
  classification: {
    Category: 'maintenance',
    Location: 'suite',
    Sub_Location: 'kitchen',
    Maintenance_Category: 'plumbing',
    Maintenance_Object: 'faucet',
    Maintenance_Problem: 'leak',
    Management_Category: 'not_applicable',
    Management_Object: 'not_applicable',
    Priority: 'normal',
  },
  model_confidence: {
    Category: 0.95,
    Location: 0.92,
    Sub_Location: 0.88,
    Maintenance_Category: 0.93,
    Maintenance_Object: 0.91,
    Maintenance_Problem: 0.89,
    Management_Category: 0.0,
    Management_Object: 0.0,
    Priority: 0.85,
  },
};

const ELECTRICAL_PRESET: Preset = {
  classification: {
    Category: 'maintenance',
    Location: 'building_interior',
    Sub_Location: 'hallways_stairwells',
    Maintenance_Category: 'electrical',
    Maintenance_Object: 'light',
    Maintenance_Problem: 'not_working',
    Management_Category: 'not_applicable',
    Management_Object: 'not_applicable',
    Priority: 'normal',
  },
  model_confidence: {
    Category: 0.92,
    Location: 0.55, // LOW — triggers followup
    Sub_Location: 0.45, // LOW — triggers followup
    Maintenance_Category: 0.88,
    Maintenance_Object: 0.90,
    Maintenance_Problem: 0.85,
    Management_Category: 0.0,
    Management_Object: 0.0,
    Priority: 0.85,
  },
};

const PEST_PRESET: Preset = {
  classification: {
    Category: 'maintenance',
    Location: 'suite',
    Sub_Location: 'bathroom',
    Maintenance_Category: 'pest_control',
    Maintenance_Object: 'cockroaches',
    Maintenance_Problem: 'infestation',
    Management_Category: 'not_applicable',
    Management_Object: 'not_applicable',
    Priority: 'normal',
  },
  model_confidence: {
    Category: 0.88,
    Location: 0.86,
    Sub_Location: 0.40, // LOW — triggers followup
    Maintenance_Category: 0.90,
    Maintenance_Object: 0.87,
    Maintenance_Problem: 0.85,
    Management_Category: 0.0,
    Management_Object: 0.0,
    Priority: 0.85,
  },
};

// Constraint chain: suite → general → hvac → radiator → no_heat
const HVAC_PRESET: Preset = {
  classification: {
    Category: 'maintenance',
    Location: 'suite',
    Sub_Location: 'general',
    Maintenance_Category: 'hvac',
    Maintenance_Object: 'radiator',
    Maintenance_Problem: 'no_heat',
    Management_Category: 'not_applicable',
    Management_Object: 'not_applicable',
    Priority: 'high',
  },
  model_confidence: {
    Category: 0.95,
    Location: 0.90,
    Sub_Location: 0.70,
    Maintenance_Category: 0.92,
    Maintenance_Object: 0.75,
    Maintenance_Problem: 0.93,
    Management_Category: 0.0,
    Management_Object: 0.0,
    Priority: 0.88,
  },
};

// Constraint chain: suite → bathroom → plumbing → toilet → clog
const PLUMBING_GENERAL_PRESET: Preset = {
  classification: {
    Category: 'maintenance',
    Location: 'suite',
    Sub_Location: 'bathroom',
    Maintenance_Category: 'plumbing',
    Maintenance_Object: 'toilet',
    Maintenance_Problem: 'clog',
    Management_Category: 'not_applicable',
    Management_Object: 'not_applicable',
    Priority: 'normal',
  },
  model_confidence: {
    Category: 0.93,
    Location: 0.88,
    Sub_Location: 0.85,
    Maintenance_Category: 0.90,
    Maintenance_Object: 0.87,
    Maintenance_Problem: 0.86,
    Management_Category: 0.0,
    Management_Object: 0.0,
    Priority: 0.85,
  },
};

// Constraint chain: suite → general → carpentry → door → broken_damaged
const CARPENTRY_PRESET: Preset = {
  classification: {
    Category: 'maintenance',
    Location: 'suite',
    Sub_Location: 'general',
    Maintenance_Category: 'carpentry',
    Maintenance_Object: 'door',
    Maintenance_Problem: 'broken_damaged',
    Management_Category: 'not_applicable',
    Management_Object: 'not_applicable',
    Priority: 'normal',
  },
  model_confidence: {
    Category: 0.92,
    Location: 0.88,
    Sub_Location: 0.80,
    Maintenance_Category: 0.85,
    Maintenance_Object: 0.82,
    Maintenance_Problem: 0.86,
    Management_Category: 0.0,
    Management_Object: 0.0,
    Priority: 0.85,
  },
};

// Constraint chain: suite → kitchen → appliance → fridge → not_working
const APPLIANCE_PRESET: Preset = {
  classification: {
    Category: 'maintenance',
    Location: 'suite',
    Sub_Location: 'kitchen',
    Maintenance_Category: 'appliance',
    Maintenance_Object: 'fridge',
    Maintenance_Problem: 'not_working',
    Management_Category: 'not_applicable',
    Management_Object: 'not_applicable',
    Priority: 'normal',
  },
  model_confidence: {
    Category: 0.93,
    Location: 0.90,
    Sub_Location: 0.88,
    Maintenance_Category: 0.91,
    Maintenance_Object: 0.85,
    Maintenance_Problem: 0.87,
    Management_Category: 0.0,
    Management_Object: 0.0,
    Priority: 0.85,
  },
};

const DEFAULT_PRESET: Preset = {
  classification: {
    Category: 'maintenance',
    Location: 'suite',
    Sub_Location: 'general',
    Maintenance_Category: 'general_maintenance',
    Maintenance_Object: 'other_object',
    Maintenance_Problem: 'not_working',
    Management_Category: 'not_applicable',
    Management_Object: 'not_applicable',
    Priority: 'normal',
  },
  model_confidence: {
    Category: 0.85,
    Location: 0.85,
    Sub_Location: 0.80,
    Maintenance_Category: 0.75,
    Maintenance_Object: 0.70,
    Maintenance_Problem: 0.70,
    Management_Category: 0.0,
    Management_Object: 0.0,
    Priority: 0.85,
  },
};

function selectPreset(text: string): Preset {
  const lower = text.toLowerCase();

  // Plumbing — faucet/leak specific
  if (lower.includes('faucet') || lower.includes('drip')) {
    return PLUMBING_PRESET;
  }
  // Plumbing — toilet/clog/drain
  if (lower.includes('toilet') || lower.includes('clog') || lower.includes('drain')) {
    return PLUMBING_GENERAL_PRESET;
  }
  // Electrical
  if (lower.includes('light') || lower.includes('hallway') || lower.includes('flickering') || lower.includes('outlet') || lower.includes('switch')) {
    return ELECTRICAL_PRESET;
  }
  // HVAC
  if (lower.includes('heat') || lower.includes('hvac') || lower.includes('radiator') || lower.includes('thermostat') || lower.includes('cold') || lower.includes('freezing')) {
    return HVAC_PRESET;
  }
  // Pest
  if (lower.includes('cockroach') || lower.includes('pest') || lower.includes('roach') || lower.includes('mouse') || lower.includes('mice') || lower.includes('ant') || lower.includes('bug') || lower.includes('rodent')) {
    return PEST_PRESET;
  }
  // Appliance
  if (lower.includes('fridge') || lower.includes('oven') || lower.includes('dishwasher') || lower.includes('washer') || lower.includes('dryer') || lower.includes('stove') || lower.includes('appliance')) {
    return APPLIANCE_PRESET;
  }
  // Carpentry / general damage
  if (lower.includes('door') || lower.includes('window') || lower.includes('cabinet') || lower.includes('broken') || lower.includes('damaged')) {
    return CARPENTRY_PRESET;
  }
  // General plumbing keywords
  if (lower.includes('leak') || lower.includes('plumbing') || lower.includes('pipe') || lower.includes('water')) {
    return PLUMBING_PRESET;
  }
  return DEFAULT_PRESET;
}

/**
 * Deterministic demo classifier. Pattern-matches on issue_summary to return
 * constraint-valid taxonomy labels with varying confidence levels.
 * Used when USE_DEMO_FIXTURES=true.
 */
export function createDemoClassifier(): (
  input: IssueClassifierInput,
  retryContext?: { retryHint: string; constraint?: string },
) => Promise<IssueClassifierOutput> {
  return async (input: IssueClassifierInput): Promise<IssueClassifierOutput> => {
    const preset = selectPreset(`${input.issue_summary} ${input.raw_excerpt}`);

    return {
      issue_id: input.issue_id,
      classification: preset.classification,
      model_confidence: preset.model_confidence,
      missing_fields: [],
      needs_human_triage: false,
    };
  };
}
