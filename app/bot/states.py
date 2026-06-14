from aiogram.fsm.state import State, StatesGroup


class AddResourceState(StatesGroup):
    waiting_attributes = State()
    waiting_quality = State()
    waiting_mosaic = State()
    waiting_direction = State()
