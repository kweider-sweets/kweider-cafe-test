-- Update the Breakfast for Two reward copy used for new rewards and push notifications.
update public.kweider_reward_definitions
set
  title_en = '🎉 Congratulations!',
  title_ar = '🎉 مبروك!',
  message_en = 'Your reward is a free breakfast for two! 🎉',
  message_ar = '🎉 مبروك! جائزتك فطور مجاني لشخصين 🎉'
where code = 'breakfast_for_two';
