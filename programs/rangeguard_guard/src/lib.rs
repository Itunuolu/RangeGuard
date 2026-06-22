use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions::{
    load_current_index_checked, load_instruction_at_checked, ID as INSTRUCTIONS_ID,
};

declare_id!("GTEGpV9Gr9uMr4CvkKHQUskrVJ8cZQRD7ewPcoRrrVps");

const DAY_SECONDS: i64 = 86_400;
const MAX_INSPECTED_INSTRUCTIONS: usize = 48;
const MAX_ALLOWED_PROGRAMS: usize = 16;
const MAX_ALLOWED_POOLS: usize = 32;

#[program]
pub mod rangeguard_guard {
    use super::*;

    pub fn initialize_policy(ctx: Context<InitializePolicy>, input: PolicyInput) -> Result<()> {
        input.validate()?;

        let policy = &mut ctx.accounts.policy;
        policy.owner = ctx.accounts.owner.key();
        policy.delegate = input.delegate;
        policy.risk_authority = input.risk_authority;
        policy.paused = true;
        policy.max_position_size_usd_micros = input.max_position_size_usd_micros;
        policy.daily_notional_limit_usd_micros = input.daily_notional_limit_usd_micros;
        policy.max_slippage_bps = input.max_slippage_bps;
        policy.max_pool_risk_score = input.max_pool_risk_score;
        policy.min_pool_liquidity_usd_micros = input.min_pool_liquidity_usd_micros;
        policy.max_open_positions = input.max_open_positions;
        policy.daily_rebalance_limit = input.daily_rebalance_limit;
        policy.stop_loss_bps = input.stop_loss_bps;
        policy.take_profit_bps = input.take_profit_bps;
        policy.allowed_pool_types_mask = input.allowed_pool_types_mask;
        policy.allowed_program_ids = input.allowed_program_ids;
        policy.allowed_pool_addresses = input.allowed_pool_addresses;
        policy.day_started_at = 0;
        policy.daily_notional_used_usd_micros = 0;
        policy.daily_rebalances_used = 0;
        policy.bump = ctx.bumps.policy;

        emit!(PolicyInitialized {
            policy: policy.key(),
            owner: policy.owner,
            delegate: policy.delegate,
            risk_authority: policy.risk_authority,
        });

        Ok(())
    }

    pub fn update_policy(ctx: Context<UpdatePolicy>, input: PolicyInput) -> Result<()> {
        input.validate()?;

        let policy = &mut ctx.accounts.policy;
        policy.delegate = input.delegate;
        policy.risk_authority = input.risk_authority;
        policy.max_position_size_usd_micros = input.max_position_size_usd_micros;
        policy.daily_notional_limit_usd_micros = input.daily_notional_limit_usd_micros;
        policy.max_slippage_bps = input.max_slippage_bps;
        policy.max_pool_risk_score = input.max_pool_risk_score;
        policy.min_pool_liquidity_usd_micros = input.min_pool_liquidity_usd_micros;
        policy.max_open_positions = input.max_open_positions;
        policy.daily_rebalance_limit = input.daily_rebalance_limit;
        policy.stop_loss_bps = input.stop_loss_bps;
        policy.take_profit_bps = input.take_profit_bps;
        policy.allowed_pool_types_mask = input.allowed_pool_types_mask;
        policy.allowed_program_ids = input.allowed_program_ids;
        policy.allowed_pool_addresses = input.allowed_pool_addresses;

        emit!(PolicyUpdated {
            policy: policy.key(),
            delegate: policy.delegate,
            risk_authority: policy.risk_authority,
        });

        Ok(())
    }

    pub fn set_policy_paused(ctx: Context<OwnerPolicyMutation>, paused: bool) -> Result<()> {
        let policy = &mut ctx.accounts.policy;
        policy.paused = paused;

        emit!(PolicyPauseChanged {
            policy: policy.key(),
            paused,
        });

        Ok(())
    }

    pub fn revoke_delegate(ctx: Context<OwnerPolicyMutation>) -> Result<()> {
        let policy = &mut ctx.accounts.policy;
        policy.delegate = Pubkey::default();
        policy.paused = true;

        emit!(DelegateRevoked {
            policy: policy.key(),
        });

        Ok(())
    }

    pub fn execute_guarded_action(
        ctx: Context<ExecuteGuardedAction>,
        input: GuardedActionInput,
    ) -> Result<()> {
        input.validate()?;

        let instructions = ctx.accounts.instructions.to_account_info();
        require_keys_eq!(
            instructions.key(),
            INSTRUCTIONS_ID,
            GuardError::InvalidInstructionsSysvar
        );

        let policy = &mut ctx.accounts.policy;
        require!(!policy.paused, GuardError::PolicyPaused);
        require_keys_neq!(
            policy.delegate,
            Pubkey::default(),
            GuardError::DelegateRevoked
        );
        require_keys_eq!(
            policy.delegate,
            ctx.accounts.delegate.key(),
            GuardError::InvalidDelegate
        );
        require_keys_eq!(
            policy.risk_authority,
            ctx.accounts.risk_authority.key(),
            GuardError::InvalidRiskAuthority
        );

        refresh_daily_counters(policy)?;

        require!(
            input.notional_usd_micros <= policy.max_position_size_usd_micros,
            GuardError::PositionSizeExceeded
        );
        require!(
            policy
                .daily_notional_used_usd_micros
                .saturating_add(input.notional_usd_micros)
                <= policy.daily_notional_limit_usd_micros,
            GuardError::DailyNotionalExceeded
        );
        require!(
            input.max_slippage_bps <= policy.max_slippage_bps,
            GuardError::SlippageExceeded
        );
        require!(
            input.pool_risk_score <= policy.max_pool_risk_score,
            GuardError::PoolRiskExceeded
        );
        require!(
            input.pool_liquidity_usd_micros >= policy.min_pool_liquidity_usd_micros,
            GuardError::PoolLiquidityTooLow
        );
        require!(
            input.open_positions_after <= policy.max_open_positions,
            GuardError::OpenPositionLimitExceeded
        );
        require!(
            policy.allowed_pool_types_mask & input.pool_type.mask() != 0,
            GuardError::PoolTypeNotAllowed
        );

        if !policy.allowed_pool_addresses.is_empty() {
            require!(
                policy.allowed_pool_addresses.contains(&input.pool_address),
                GuardError::PoolNotAllowed
            );
        }

        if matches!(
            input.action_type,
            GuardedActionType::Rebalance | GuardedActionType::CopyLp
        ) {
            require!(
                policy.daily_rebalances_used < policy.daily_rebalance_limit,
                GuardError::DailyRebalanceLimitExceeded
            );
        }

        require_all_targets_allowlisted(policy, &input.target_program_ids)?;
        inspect_transaction_targets(
            &instructions,
            &input.target_program_ids,
            &policy.allowed_program_ids,
        )?;

        policy.daily_notional_used_usd_micros = policy
            .daily_notional_used_usd_micros
            .saturating_add(input.notional_usd_micros);

        if matches!(
            input.action_type,
            GuardedActionType::Rebalance | GuardedActionType::CopyLp
        ) {
            policy.daily_rebalances_used = policy.daily_rebalances_used.saturating_add(1);
        }

        emit!(GuardedActionApproved {
            policy: policy.key(),
            delegate: ctx.accounts.delegate.key(),
            action_hash: input.action_hash,
            action_type: input.action_type,
            pool_address: input.pool_address,
            notional_usd_micros: input.notional_usd_micros,
        });

        Ok(())
    }
}

fn refresh_daily_counters(policy: &mut Account<GuardPolicy>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    if policy.day_started_at == 0 || now.saturating_sub(policy.day_started_at) >= DAY_SECONDS {
        policy.day_started_at = now;
        policy.daily_notional_used_usd_micros = 0;
        policy.daily_rebalances_used = 0;
    }

    Ok(())
}

fn require_all_targets_allowlisted(
    policy: &GuardPolicy,
    target_program_ids: &[Pubkey],
) -> Result<()> {
    require!(!target_program_ids.is_empty(), GuardError::NoTargetPrograms);

    for target_program_id in target_program_ids {
        require!(
            policy.allowed_program_ids.contains(target_program_id),
            GuardError::TargetProgramNotAllowed
        );
    }

    Ok(())
}

fn inspect_transaction_targets(
    instructions: &AccountInfo,
    target_program_ids: &[Pubkey],
    allowed_program_ids: &[Pubkey],
) -> Result<()> {
    let current_index = load_current_index_checked(instructions)? as usize;
    let mut inspected_targets = 0_u8;

    for index in 0..MAX_INSPECTED_INSTRUCTIONS {
        let instruction = match load_instruction_at_checked(index, instructions) {
            Ok(instruction) => instruction,
            Err(_) => break,
        };

        if index == current_index || instruction.program_id == crate::ID {
            continue;
        }

        require!(
            target_program_ids.contains(&instruction.program_id),
            GuardError::UnexpectedTransactionProgram
        );
        require!(
            allowed_program_ids.contains(&instruction.program_id),
            GuardError::TargetProgramNotAllowed
        );
        inspected_targets = inspected_targets.saturating_add(1);
    }

    require!(inspected_targets > 0, GuardError::NoTargetInstructions);

    Ok(())
}

#[derive(Accounts)]
pub struct InitializePolicy<'info> {
    #[account(
        init,
        payer = owner,
        space = GuardPolicy::LEN,
        seeds = [b"rangeguard-policy", owner.key().as_ref()],
        bump
    )]
    pub policy: Account<'info, GuardPolicy>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdatePolicy<'info> {
    #[account(mut, has_one = owner @ GuardError::InvalidOwner)]
    pub policy: Account<'info, GuardPolicy>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct OwnerPolicyMutation<'info> {
    #[account(mut, has_one = owner @ GuardError::InvalidOwner)]
    pub policy: Account<'info, GuardPolicy>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct ExecuteGuardedAction<'info> {
    #[account(mut)]
    pub policy: Account<'info, GuardPolicy>,
    pub delegate: Signer<'info>,
    pub risk_authority: Signer<'info>,
    /// CHECK: Verified against the instructions sysvar id before use.
    pub instructions: UncheckedAccount<'info>,
}

#[account]
pub struct GuardPolicy {
    pub owner: Pubkey,
    pub delegate: Pubkey,
    pub risk_authority: Pubkey,
    pub paused: bool,
    pub max_position_size_usd_micros: u64,
    pub daily_notional_limit_usd_micros: u64,
    pub max_slippage_bps: u16,
    pub max_pool_risk_score: u8,
    pub min_pool_liquidity_usd_micros: u64,
    pub max_open_positions: u8,
    pub daily_rebalance_limit: u8,
    pub stop_loss_bps: u16,
    pub take_profit_bps: u16,
    pub allowed_pool_types_mask: u8,
    pub allowed_program_ids: Vec<Pubkey>,
    pub allowed_pool_addresses: Vec<Pubkey>,
    pub day_started_at: i64,
    pub daily_notional_used_usd_micros: u64,
    pub daily_rebalances_used: u8,
    pub bump: u8,
}

impl GuardPolicy {
    pub const LEN: usize = 8
        + 32
        + 32
        + 32
        + 1
        + 8
        + 8
        + 2
        + 1
        + 8
        + 1
        + 1
        + 2
        + 2
        + 1
        + 4
        + (MAX_ALLOWED_PROGRAMS * 32)
        + 4
        + (MAX_ALLOWED_POOLS * 32)
        + 8
        + 8
        + 1
        + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PolicyInput {
    pub delegate: Pubkey,
    pub risk_authority: Pubkey,
    pub max_position_size_usd_micros: u64,
    pub daily_notional_limit_usd_micros: u64,
    pub max_slippage_bps: u16,
    pub max_pool_risk_score: u8,
    pub min_pool_liquidity_usd_micros: u64,
    pub max_open_positions: u8,
    pub daily_rebalance_limit: u8,
    pub stop_loss_bps: u16,
    pub take_profit_bps: u16,
    pub allowed_pool_types_mask: u8,
    pub allowed_program_ids: Vec<Pubkey>,
    pub allowed_pool_addresses: Vec<Pubkey>,
}

impl PolicyInput {
    pub fn validate(&self) -> Result<()> {
        require_keys_neq!(
            self.delegate,
            Pubkey::default(),
            GuardError::InvalidDelegate
        );
        require_keys_neq!(
            self.risk_authority,
            Pubkey::default(),
            GuardError::InvalidRiskAuthority
        );
        require_keys_neq!(
            self.risk_authority,
            self.delegate,
            GuardError::RiskAuthorityMustBeIndependent
        );
        require!(
            self.allowed_program_ids.len() <= MAX_ALLOWED_PROGRAMS,
            GuardError::TooManyAllowedPrograms
        );
        require!(
            self.allowed_pool_addresses.len() <= MAX_ALLOWED_POOLS,
            GuardError::TooManyAllowedPools
        );
        require!(
            self.max_pool_risk_score <= 100,
            GuardError::InvalidRiskScore
        );
        require!(
            self.allowed_pool_types_mask != 0,
            GuardError::NoPoolTypesAllowed
        );
        require!(
            self.daily_notional_limit_usd_micros >= self.max_position_size_usd_micros,
            GuardError::InvalidLimitConfiguration
        );

        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum GuardedActionType {
    OpenPosition,
    Rebalance,
    ClaimFees,
    ClosePosition,
    CopyLp,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum GuardedPoolType {
    Stable,
    BlueChip,
    Any,
}

impl GuardedPoolType {
    pub fn mask(self) -> u8 {
        match self {
            GuardedPoolType::Stable => 1,
            GuardedPoolType::BlueChip => 2,
            GuardedPoolType::Any => 4,
        }
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct GuardedActionInput {
    pub action_hash: [u8; 32],
    pub action_type: GuardedActionType,
    pub pool_address: Pubkey,
    pub pool_type: GuardedPoolType,
    pub target_program_ids: Vec<Pubkey>,
    pub notional_usd_micros: u64,
    pub max_slippage_bps: u16,
    pub pool_risk_score: u8,
    pub pool_liquidity_usd_micros: u64,
    pub open_positions_after: u8,
    pub proposed_lower_bin: i32,
    pub proposed_upper_bin: i32,
}

impl GuardedActionInput {
    pub fn validate(&self) -> Result<()> {
        require!(self.pool_risk_score <= 100, GuardError::InvalidRiskScore);
        require!(
            self.target_program_ids.len() <= MAX_ALLOWED_PROGRAMS,
            GuardError::TooManyTargetPrograms
        );

        if matches!(
            self.action_type,
            GuardedActionType::OpenPosition
                | GuardedActionType::Rebalance
                | GuardedActionType::CopyLp
        ) {
            require!(
                self.proposed_lower_bin < self.proposed_upper_bin,
                GuardError::InvalidRange
            );
        }

        Ok(())
    }
}

#[event]
pub struct PolicyInitialized {
    pub policy: Pubkey,
    pub owner: Pubkey,
    pub delegate: Pubkey,
    pub risk_authority: Pubkey,
}

#[event]
pub struct PolicyUpdated {
    pub policy: Pubkey,
    pub delegate: Pubkey,
    pub risk_authority: Pubkey,
}

#[event]
pub struct PolicyPauseChanged {
    pub policy: Pubkey,
    pub paused: bool,
}

#[event]
pub struct DelegateRevoked {
    pub policy: Pubkey,
}

#[event]
pub struct GuardedActionApproved {
    pub policy: Pubkey,
    pub delegate: Pubkey,
    pub action_hash: [u8; 32],
    pub action_type: GuardedActionType,
    pub pool_address: Pubkey,
    pub notional_usd_micros: u64,
}

#[error_code]
pub enum GuardError {
    #[msg("Only the policy owner can mutate this policy.")]
    InvalidOwner,
    #[msg("Policy is paused.")]
    PolicyPaused,
    #[msg("The delegated keeper does not match the policy.")]
    InvalidDelegate,
    #[msg("The independent risk authority does not match the policy.")]
    InvalidRiskAuthority,
    #[msg("Risk authority must be separate from the keeper delegate.")]
    RiskAuthorityMustBeIndependent,
    #[msg("The delegated keeper was revoked.")]
    DelegateRevoked,
    #[msg("The instructions sysvar account is invalid.")]
    InvalidInstructionsSysvar,
    #[msg("Position size cap exceeded.")]
    PositionSizeExceeded,
    #[msg("Daily notional cap exceeded.")]
    DailyNotionalExceeded,
    #[msg("Slippage cap exceeded.")]
    SlippageExceeded,
    #[msg("Pool risk cap exceeded.")]
    PoolRiskExceeded,
    #[msg("Pool liquidity is below the policy floor.")]
    PoolLiquidityTooLow,
    #[msg("Open position limit exceeded.")]
    OpenPositionLimitExceeded,
    #[msg("Pool type is not allowed by policy.")]
    PoolTypeNotAllowed,
    #[msg("Pool address is not allowed by policy.")]
    PoolNotAllowed,
    #[msg("Daily rebalance limit exceeded.")]
    DailyRebalanceLimitExceeded,
    #[msg("No target programs were supplied.")]
    NoTargetPrograms,
    #[msg("No executable target instructions were found in the transaction.")]
    NoTargetInstructions,
    #[msg("A target program is not allowlisted by policy.")]
    TargetProgramNotAllowed,
    #[msg("The transaction includes a program outside the declared target set.")]
    UnexpectedTransactionProgram,
    #[msg("Too many allowed programs were provided.")]
    TooManyAllowedPrograms,
    #[msg("Too many allowed pool addresses were provided.")]
    TooManyAllowedPools,
    #[msg("Too many target programs were provided.")]
    TooManyTargetPrograms,
    #[msg("Risk score must be between 0 and 100.")]
    InvalidRiskScore,
    #[msg("At least one pool type must be allowed.")]
    NoPoolTypesAllowed,
    #[msg("Daily limit must be greater than or equal to max position size.")]
    InvalidLimitConfiguration,
    #[msg("The proposed lower bin must be below the upper bin.")]
    InvalidRange,
}
