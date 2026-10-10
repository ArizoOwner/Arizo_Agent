// Shapes shared by the translation engines and the front end (camelCase JSON).

use serde::Serialize;

#[derive(Serialize, Clone, Default, Debug, PartialEq)]
pub struct Alternative {
    pub pos: String,
    pub terms: Vec<String>,
}

#[derive(Serialize, Clone, Default, Debug, PartialEq)]
pub struct BreakdownItem {
    pub term: String,
    pub meaning: String,
    pub explanation: String,
}

/// What one translation looks like, whichever engine produced it.
#[derive(Serialize, Clone, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TranslationData {
    pub translation: String,
    pub translit: String,
    pub alternatives: Vec<Alternative>,
    pub detected_lang: String,
    pub target_lang: String,
    pub breakdown: Vec<BreakdownItem>,
    pub variants: Vec<String>,
    pub critique_notes: String,
    pub tone_used: String,
    pub engine: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct Warning {
    pub code: String,
    pub message: String,
}

/// The answer to one `translate` call.
#[derive(Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Reply {
    pub request_id: u64,
    pub success: bool,
    pub cached: bool,
    pub aborted: bool,
    pub warning: Option<Warning>,
    pub data: Option<TranslationData>,
    pub error: Option<String>,
    pub error_code: Option<String>,
}
