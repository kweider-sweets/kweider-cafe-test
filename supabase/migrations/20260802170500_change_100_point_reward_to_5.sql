update public.kweider_reward_definitions
set
  title_en = '£5 Off Your Next Bill',
  title_ar = 'خصم £5 على فاتورتك القادمة',
  message_en = 'Use this reward on your next eligible bill. The discount is up to £5 and cannot exceed the bill total.',
  message_ar = 'استخدم هذه المكافأة على فاتورتك المؤهلة القادمة. الخصم حتى £5 ولا يتجاوز إجمالي الفاتورة.',
  percent_off = 100.00,
  maximum_discount = 5.00,
  updated_at = now()
where code = 'discount_5'
  and threshold_points = 100;
